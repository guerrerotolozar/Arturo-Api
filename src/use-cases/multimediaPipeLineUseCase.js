/**
 * multimediaPipelineUseCase.js — Procesa videos de TikTok/Instagram/YouTube.
 *
 * FLUJO:
 * 1. yt-dlp descarga el video
 * 2. ffmpeg extrae el audio (WAV 16kHz, mono — formato que espera Whisper)
 * 3. whisper.cpp transcribe el audio → texto
 * 4. ffmpeg extrae frames (1 por segundo)
 * 5. visionAdapter analiza cada frame buscando texto en pantalla
 * 6. LLM sintetiza todo en una nota Markdown
 * 7. La nota va al Inbox para que el conserje la organice
 *
 * SOBRE FRAME SAMPLING:
 * La idea de Gemini es sólida. Para videos con música pero sin locutor
 * (tutoriales con texto superpuesto, slides de TikTok), el frame sampling
 * es la única forma de capturar el contenido. 1fps es suficiente.
 * Para reducir carga: puedes subir a 0.5fps (un frame cada 2s) si el video
 * tiene texto estático por varios segundos.
 *
 * ALTERNATIVA a frame sampling: algunos videos tienen subtítulos embebidos
 * que yt-dlp puede extraer directamente con --write-subs --sub-lang es.
 * Si existen, son más confiables que el OCR. El pipeline los usa si están disponibles.
 */

const { execFile, spawn } = require('child_process');
const { promisify }       = require('util');
const execFileAsync       = promisify(execFile);
const fs                  = require('fs');
const path                = require('path');
const os                  = require('os');
const ffmpeg              = require('fluent-ffmpeg');

const { analizarImagen }           = require('../adapters/visionAdapter');
const { llamarOllama }             = require('../adapters/ollamaAdapter');
const { escribirArchivo, asegurarDirectorio } = require('../repositories/vaultRepository');
const { obtenerTimestamp }         = require('../utils/dateUtils');
const { obtenerPrompt }            = require('../utils/promptManager');
const { VAULT_PATH, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');

const WHISPER_PATH = process.env.WHISPER_BIN || '/home/ronald/whisper.cpp/main';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/home/ronald/whisper.cpp/models/ggml-base.en.bin';
const FRAMES_PER_SEC = parseFloat(process.env.VIDEO_FPS || '0.5');
const MAX_FRAMES     = parseInt(process.env.VIDEO_MAX_FRAMES || '30');

/**
 * Descarga el video y extrae subtítulos si están disponibles.
 * @returns {{ videoPath, subtitulos: string|null }}
 */
async function descargarVideo(url, tmpDir) {
    console.log(`[PIPELINE] Descargando: ${url}`);
    const videoPath = path.join(tmpDir, 'video.mp4');

    // Intenta extraer subtítulos primero (mucho más rápido que OCR)
    try {
        await execFileAsync('yt-dlp', [
            '--write-auto-subs', '--sub-lang', 'es,en',
            '--skip-download', '--output', path.join(tmpDir, 'subs'),
            url
        ]);
    } catch { /* sin subtítulos disponibles */ }

    await execFileAsync('yt-dlp', [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o', videoPath, url
    ]);

    // Buscar archivo de subtítulos generado
    const subsFile = fs.readdirSync(tmpDir).find(f => f.endsWith('.vtt') || f.endsWith('.srt'));
    const subtitulos = subsFile
        ? fs.readFileSync(path.join(tmpDir, subsFile), 'utf-8').replace(/\d+:\d+:\d+\.\d+ --> \d+:\d+:\d+\.\d+\n/g, '').replace(/<[^>]+>/g, '').trim()
        : null;

    return { videoPath, subtitulos };
}

/**
 * Extrae audio WAV a 16kHz mono (formato ideal para Whisper).
 */
function extraerAudio(videoPath, tmpDir) {
    return new Promise((res, rej) => {
        const audioPath = path.join(tmpDir, 'audio.wav');
        ffmpeg(videoPath)
            .audioChannels(1)
            .audioFrequency(16000)
            .audioCodec('pcm_s16le')
            .output(audioPath)
            .on('end', () => res(audioPath))
            .on('error', rej)
            .run();
    });
}

/**
 * Extrae frames a N fps usando ffmpeg.
 * @returns {string[]} rutas de los frames
 */
function extraerFrames(videoPath, tmpDir) {
    return new Promise((res, rej) => {
        const framesDir = path.join(tmpDir, 'frames');
        asegurarDirectorio(framesDir);
        ffmpeg(videoPath)
            .outputOptions([`-vf fps=${FRAMES_PER_SEC}`, '-q:v 2'])
            .output(path.join(framesDir, 'frame_%04d.jpg'))
            .on('end', () => {
                const frames = fs.readdirSync(framesDir)
                    .filter(f => f.endsWith('.jpg'))
                    .slice(0, MAX_FRAMES)
                    .map(f => path.join(framesDir, f));
                res(frames);
            })
            .on('error', rej)
            .run();
    });
}

/**
 * Transcribe audio con whisper.cpp (mucho más rápido que Python Whisper en CPU).
 * @returns {string} transcripción
 */
function transcribirAudio(audioPath) {
    return new Promise((res, rej) => {
        const proc = spawn(WHISPER_PATH, [
            '-m', WHISPER_MODEL,
            '-f', audioPath,
            '-l', 'auto',
            '--output-txt', '--no-timestamps'
        ]);
        let output = '';
        proc.stdout.on('data', d => output += d);
        proc.stderr.on('data', () => {});
        proc.on('close', code => code === 0 ? res(output.trim()) : rej(new Error(`Whisper exit ${code}`)));
    });
}

/**
 * Analiza frames con el VLM buscando texto en pantalla.
 * Devuelve solo los frames con contenido textual significativo.
 */
async function analizarFrames(frames) {
    const textos = [];
    for (let i = 0; i < frames.length; i++) {
        console.log(`[PIPELINE] Analizando frame ${i+1}/${frames.length}...`);
        try {
            const promptDefecto = 'Extrae SOLO el texto visible en pantalla (subtítulos, captions, texto superpuesto). Si no hay texto, responde "SIN_TEXTO".';
            const prompt = obtenerPrompt('analisis_frames.md', promptDefecto);
            const resultado = await analizarImagen(
                frames[i],
                prompt
            );
            if (!resultado.texto.includes('SIN_TEXTO') && resultado.texto.length > 10) {
                textos.push(resultado.texto);
            }
        } catch (e) {
            console.warn(`[PIPELINE] Frame ${i+1} fallo: ${e.message}`);
        }
    }
    // Deduplicar textos similares
    return [...new Set(textos)];
}

/**
 * Pipeline completo: URL → nota Markdown en Inbox.
 * @param {string} url
 * @returns {{ notaRuta: string, duracionMs: number }}
 */
async function procesarVideo(url) {
    const t0     = Date.now();
    const tmpDir = path.join(os.tmpdir(), `arturo_video_${Date.now()}`);
    asegurarDirectorio(tmpDir);

    try {
        // Paso 1: Descargar
        const { videoPath, subtitulos } = await descargarVideo(url, tmpDir);

        // Paso 2+3: Audio y Whisper (en paralelo con frame sampling)
        const [audioPath, frames] = await Promise.all([
            extraerAudio(videoPath, tmpDir),
            extraerFrames(videoPath, tmpDir)
        ]);

        // Paso 3: Transcripción Whisper
        let transcripcion = 'Sin audio transcrito.';
        try { transcripcion = await transcribirAudio(audioPath); }
        catch (e) { console.warn(`[PIPELINE] Whisper fallo: ${e.message}`); }

        // Paso 4: OCR de frames (solo si no hay subtítulos)
        let textosFrames = [];
        if (!subtitulos && frames.length > 0) {
            textosFrames = await analizarFrames(frames);
        }

        // Paso 5: Síntesis LLM
        const contexto = [
            subtitulos ? `SUBTITULOS EXTRAIDOS:\n${subtitulos}` : '',
            transcripcion !== 'Sin audio transcrito.' ? `TRANSCRIPCION AUDIO:\n${transcripcion}` : '',
            textosFrames.length > 0 ? `TEXTO EN PANTALLA (OCR frames):\n${textosFrames.join('\n---\n')}` : ''
        ].filter(Boolean).join('\n\n');

        const promptDefecto = `Eres Arturo. ${PERFIL_RONALD}\nSintetiza el contenido de este video en una nota Markdown para el Segundo Cerebro de Ronald.\n\nGenera una nota con:\n- ## Resumen (3-5 puntos clave)\n- ## Conceptos importantes (con [[enlaces]])\n- ## Fuente y metadatos`;
        const promptBase = obtenerPrompt('sintesis_video.md', promptDefecto);
        const prompt = `${promptBase}\n\nURL: ${url}\n\nCONTENIDO EXTRAIDO:\n${contexto}\n\nMarkdown:`;

        const notaMd = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);

        // Paso 6: Guardar en Inbox
        const ts       = obtenerTimestamp();
        const nombre   = `Video_${Date.now()}.md`;
        const inboxDir = path.join(VAULT_PATH, 'Inbox');
        asegurarDirectorio(inboxDir);
        const rutaAbs  = path.join(inboxDir, nombre);

        const contenido = ['---', `tipo: video_procesado`, `creado: ${ts}`, `url: ${url}`, '---', notaMd].join('\n');
        escribirArchivo(rutaAbs, contenido);

        console.log(`[PIPELINE] Completado en ${((Date.now()-t0)/1000).toFixed(1)}s → Inbox/${nombre}`);
        return { notaRuta: `Inbox/${nombre}`, duracionMs: Date.now() - t0 };

    } finally {
        // Limpiar temporales
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

module.exports = { procesarVideo };
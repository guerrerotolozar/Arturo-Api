/**
 * videoAdapter.js — Procesa videos: extrae frames + audio.
 *
 * Flujo:
 *   1. Recibe base64 del video → guarda como .mp4 temporal
 *   2. FFmpeg extrae N frames equidistantes como .jpg
 *   3. FFmpeg extrae audio como .wav 16kHz mono (formato Whisper)
 *   4. Llama a visionAdapter por cada frame
 *   5. Llama a whisperAdapter para transcribir el audio
 *   6. Devuelve contexto unificado
 *   7. Limpia todos los temporales
 *
 * Requisito: ffmpeg instalado en el sistema (sudo apt install ffmpeg)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { analizarImagen } = require('./visionAdapter');
const { transcribirAudio } = require('./whisperAdapter');

const MAX_FRAMES = 3; // Frames a extraer (más = más contexto pero más lento en CPU)

/**
 * Ejecuta un comando FFmpeg y devuelve una promesa.
 */
function ejecutarFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            code === 0 ? resolve(stderr) : reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-200)}`));
        });
    });
}

/**
 * Obtiene la duración de un video en segundos.
 */
function obtenerDuracion(videoPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            videoPath
        ]);
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.on('close', code => {
            if (code !== 0) return reject(new Error('ffprobe falló'));
            resolve(parseFloat(out.trim()) || 10);
        });
    });
}

/**
 * Procesa un video completo: extrae frames + transcribe audio.
 *
 * @param {string} videoBase64 - Video en base64 puro (sin prefijo data:...)
 * @param {function} onEstado - Callback para reportar progreso al cliente
 * @returns {Promise<{contextoVisual: string, transcripcion: string}>}
 */
async function procesarVideo(videoBase64, onEstado = () => {}) {
    const tmpDir = path.join(os.tmpdir(), `arturo_video_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const videoPath = path.join(tmpDir, 'input.mp4');
    const audioPath = path.join(tmpDir, 'audio.wav');

    try {
        // 1. Guardar video temporal
        const buffer = Buffer.from(videoBase64, 'base64');
        fs.writeFileSync(videoPath, buffer);
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        console.log(`[VIDEO] Guardado temporal: ${sizeMB} MB`);

        // 2. Obtener duración
        let duracion;
        try {
            duracion = await obtenerDuracion(videoPath);
        } catch {
            duracion = 10; // fallback si ffprobe falla
        }
        console.log(`[VIDEO] Duración: ${duracion.toFixed(1)}s`);

        // 3. Extraer frames equidistantes
        onEstado('Extrayendo frames del video...');
        const framePaths = [];
        const intervalo = duracion / (MAX_FRAMES + 1);

        for (let i = 1; i <= MAX_FRAMES; i++) {
            const tiempo = (intervalo * i).toFixed(2);
            const framePath = path.join(tmpDir, `frame_${i}.jpg`);
            
            await ejecutarFFmpeg([
                '-ss', tiempo,
                '-i', videoPath,
                '-vframes', '1',
                '-q:v', '3',       // calidad JPEG (2=mejor, 5=peor)
                '-vf', 'scale=800:-1', // max 800px ancho
                '-y', framePath
            ]);

            if (fs.existsSync(framePath)) {
                framePaths.push(framePath);
            }
        }
        console.log(`[VIDEO] Extraídos ${framePaths.length} frames`);

        // 4. Extraer audio para Whisper
        onEstado('Extrayendo audio del video...');
        let tieneAudio = true;
        try {
            await ejecutarFFmpeg([
                '-i', videoPath,
                '-vn',              // sin video
                '-acodec', 'pcm_s16le',
                '-ar', '16000',     // 16kHz para Whisper
                '-ac', '1',         // mono
                '-y', audioPath
            ]);
        } catch {
            console.warn('[VIDEO] No se pudo extraer audio (puede que el video no tenga pista de audio)');
            tieneAudio = false;
        }

        // 5. Analizar frames con Vision
        const descripciones = [];
        for (let i = 0; i < framePaths.length; i++) {
            onEstado(`Analizando frame ${i + 1}/${framePaths.length}...`);
            console.log(`[VIDEO] Analizando frame ${i + 1}/${framePaths.length}...`);
            try {
                const b64 = fs.readFileSync(framePaths[i]).toString('base64');
                const vision = await analizarImagen(b64, `Describe brevemente qué se ve en este frame de un video (frame ${i + 1} de ${framePaths.length}). Sé conciso.`);
                descripciones.push(`Frame ${i + 1}: ${vision.texto}`);
            } catch (err) {
                console.warn(`[VIDEO] Error analizando frame ${i + 1}: ${err.message}`);
                descripciones.push(`Frame ${i + 1}: (no se pudo analizar)`);
            }
        }

        // 6. Transcribir audio con Whisper
        let transcripcion = '';
        if (tieneAudio && fs.existsSync(audioPath)) {
            onEstado('Transcribiendo audio del video...');
            console.log('[VIDEO] Transcribiendo audio con Whisper...');
            try {
                const audioBuffer = fs.readFileSync(audioPath);
                transcripcion = await transcribirAudio(audioBuffer);
                console.log(`[VIDEO] Transcripción completada (${transcripcion.length} chars)`);
            } catch (err) {
                console.warn(`[VIDEO] Error en transcripción: ${err.message}`);
            }
        }

        const contextoVisual = descripciones.join('\n');
        return { contextoVisual, transcripcion };

    } finally {
        // 7. Limpiar temporales
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log('[VIDEO] Temporales limpiados');
        } catch (e) {
            console.warn(`[VIDEO] No se pudieron limpiar temporales: ${e.message}`);
        }
    }
}

module.exports = { procesarVideo };

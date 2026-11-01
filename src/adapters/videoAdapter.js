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
const { transcribirAudio } = require('./whisperAdapter');

const DEFAULT_MAX_FRAMES = 3; // Frames a extraer por defecto

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
 * Procesa un video directamente desde su ruta en disco.
 * Extrae frames equidistantes + transcribe audio con Whisper.
 *
 * @param {string} videoPath - Ruta absoluta al archivo de video
 * @param {function} onEstado - Callback para reportar progreso al cliente
 * @param {number} maxFrames - Número de frames a extraer (por defecto 3)
 * @returns {Promise<{contextoVisual: string, transcripcion: string}>}
 */
async function procesarVideoDesdeRuta(videoPath, onEstado = () => {}, maxFrames = DEFAULT_MAX_FRAMES) {
    const tmpDir = path.join(os.tmpdir(), `arturo_video_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const audioPath = path.join(tmpDir, 'audio.wav');

    try {
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
        
        if (maxFrames === 'auto' || maxFrames === -1) {
            console.log(`[VIDEO] Modo Inteligente (Temporal Tiling): Extrayendo grillas dinámicamente con mpdecimate (max 1 fps, tile 3x3)...`);
            
            // Ejecutar FFmpeg una sola vez para extraer todos los keyframes
            // fps=1: Límite de 1 frame por segundo máximo
            // mpdecimate: Elimina frames casi idénticos
            // showinfo: Extrae los timestamps exactos de los frames sobrevivientes
            // scale=256:-1: Escala a 256px de ancho
            // tile=3x3: Agrupa hasta 9 frames en un solo mosaico para no saturar la VRAM del modelo
            const ffmpegOutput = await ejecutarFFmpeg([
                '-i', videoPath,
                '-vf', 'fps=1,mpdecimate,showinfo,scale=256:-1,tile=3x3',
                '-vsync', 'vfr',
                '-q:v', '3',
                '-y', path.join(tmpDir, 'grid_%04d.jpg')
            ]);

            // Parsear timestamps para sincronización con audio
            const ptsRegex = /pts_time:([\d\.]+)/g;
            let match;
            const ptsTimes = [];
            while ((match = ptsRegex.exec(ffmpegOutput)) !== null) {
                ptsTimes.push(parseFloat(match[1]));
            }

            const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('grid_') && f.endsWith('.jpg')).sort();
            for (const file of files) {
                framePaths.push(path.join(tmpDir, file));
            }
            console.log(`[VIDEO] Extracción inteligente finalizada: ${framePaths.length} mosaicos capturados (de ${duracion.toFixed(1)}s de video).`);
            // Guardamos los ptsTimes en el propio array para que estén disponibles luego
            framePaths.ptsTimes = ptsTimes;
            
        } else {
            console.log(`[VIDEO] Modo Uniforme: Extrayendo exactamente ${maxFrames} frames (800px)...`);
            const intervalo = duracion / (maxFrames + 1);
            framePaths.ptsTimes = [];

            for (let i = 1; i <= maxFrames; i++) {
                const tiempo = (intervalo * i).toFixed(2);
                const framePath = path.join(tmpDir, `frame_${i}.jpg`);
                
                await ejecutarFFmpeg([
                    '-ss', tiempo,
                    '-i', videoPath,
                    '-vframes', '1',
                    '-q:v', '3',
                    '-vf', 'scale=800:-1',
                    '-y', framePath
                ]);

                if (fs.existsSync(framePath)) {
                    framePaths.push(framePath);
                    framePaths.ptsTimes.push(parseFloat(tiempo));
                }
            }
        }

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

        // 5. Analizar frames con Vision usando LangChain
        const descripciones = [];
        const { ChatOllama } = require("@langchain/ollama");
        const { HumanMessage } = require("@langchain/core/messages");
        const { OLLAMA_MODEL_VISION, OLLAMA_URL } = require('../config/env');
        const cliProgress = require('cli-progress');
        
        const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
        // El LLM Visual evalúa CADA MOSAICO DE FORMA INDIVIDUAL Y AISLADA.
        // Tokens de entrada (417) + Tokens max generados (~1400) = ~1817 tokens máximos por petición.
        // Fijamos numCtx en 4096 por petición del usuario, para dar un "colchón" generoso y evitar que el modelo sufra al redactar.
        // Seguirá usando muy poca VRAM comparado con el default de Ollama.
        const visionLlm = new ChatOllama({ baseUrl, model: OLLAMA_MODEL_VISION || 'robit/ornith-vision:9b', temperature: 0.1, numCtx: 4096 });

        console.log(`[VIDEO] Iniciando análisis visual de ${framePaths.length} mosaicos con LangChain...`);
        
        // --- MAGIA PRO: Barra de progreso a prueba de Docker Buffering ---
        // Docker retiene los logs si no llevan \n. Para lograr el efecto de "una sola línea"
        // sin que Docker lo bloquee, imprimimos \n en cada actualización, pero usamos 
        // códigos ANSI (\x1b[1A) para mover el cursor hacia arriba y sobrescribir.
        
        let barActive = true;
        let currentFrame = 0;
        const totalFrames = framePaths.length;
        const timeStart = Date.now();

        const drawBar = (isRedraw = false) => {
            if (!barActive) return;
            const percent = Math.floor((currentFrame / totalFrames) * 100);
            const filled = Math.floor(percent / 2);
            const bar = '█'.repeat(filled) + '░'.repeat(50 - filled);
            const elapsed = (Date.now() - timeStart) / 1000;
            const eta = currentFrame > 0 ? Math.max(0, Math.floor((elapsed / currentFrame) * (totalFrames - currentFrame))) : '?';
            
            const line = `[VIDEO] 👁️ Analizando | \x1b[36m${bar}\x1b[0m | ${percent}% || ${currentFrame}/${totalFrames} mosaicos || Faltan: ${eta}s`;
            
            // Si no es el primer renderizado (o redibujado post-log), subimos el cursor una línea
            if (!isRedraw && currentFrame > 0) {
                // Sube el cursor 1 línea, y limpia desde la posición actual (manteniendo el prefijo de Docker intacto)
                process.stdout.write('\x1b[1A\x1b[K'); 
            }
            // Imprime la barra sin retorno de carro, así se posiciona perfectamente después de "Arturo-Api | "
            process.stdout.write(`${line}\n`);
        };

        const originalConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
        const safeLog = (originalFn) => (...args) => {
            if (barActive) process.stdout.write('\x1b[1A\x1b[K'); // Borra la barra actual (sube y borra el texto, no el prefijo)
            originalFn.apply(console, args); // Imprime el log intruso (ej. Vigilante)
            if (barActive) drawBar(true); // Redibuja la barra abajo como "primer render"
        };
        console.log = safeLog(originalConsole.log);
        console.warn = safeLog(originalConsole.warn);
        console.error = safeLog(originalConsole.error);
        console.info = safeLog(originalConsole.info);
        // ------------------------------------------------------------------

        drawBar(true); // Render inicial

        // El prompt equilibrado diseñado por el usuario
        const promptEquilibrado = "Resume de forma concisa el contenido técnico que ocurre en secuencia temporal de este mosaico. Ignora al presentador y la interfaz de usuario. Concéntrate en extraer conceptos, diagramas o texto relevante de las diapositivas. Lee la cuadrícula de izquierda a derecha, de arriba a abajo.";

        for (let i = 0; i < framePaths.length; i++) {
            try {
                // Calcular tiempo exacto de inicio y fin para este mosaico
                let startTime = 0;
                let endTime = duracion;
                
                if (maxFrames === 'auto' || maxFrames === -1) {
                    // Modo Inteligente (9 frames por mosaico)
                    startTime = framePaths.ptsTimes[i * 9] !== undefined ? framePaths.ptsTimes[i * 9] : 0;
                    endTime = framePaths.ptsTimes[(i + 1) * 9] !== undefined ? framePaths.ptsTimes[(i + 1) * 9] : duracion;
                } else {
                    // Modo Uniforme (1 frame por "mosaico")
                    startTime = framePaths.ptsTimes[i] !== undefined ? framePaths.ptsTimes[i] : 0;
                    endTime = framePaths.ptsTimes[i + 1] !== undefined ? framePaths.ptsTimes[i + 1] : duracion;
                }

                const base64 = fs.readFileSync(framePaths[i], 'base64');
                const msg = new HumanMessage({
                    content: [
                        { type: "text", text: promptEquilibrado },
                        { type: "image_url", image_url: `data:image/jpeg;base64,${base64}` }
                    ]
                });
                const res = await visionLlm.invoke([msg]);
                
                descripciones.push({
                    mosaico: i + 1,
                    start: startTime,
                    end: endTime,
                    texto: res.content.trim()
                });
                
                currentFrame++;
                drawBar();
            } catch (err) {
                console.warn(`[VIDEO] Error analizando frame ${i+1}: ${err.message}`);
                currentFrame++;
                drawBar();
            }
        }
        
        // --- PURGA DE VRAM ---
        // Forzamos a Ollama a descargar el modelo de visión inmediatamente para dejar espacio a Whisper
        try {
            console.log("\n[VIDEO] Purga de VRAM: Descargando modelo de visión...");
            await fetch(baseUrl + '/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: OLLAMA_MODEL_VISION || 'robit/ornith-vision:9b', keep_alive: 0 })
            });
        } catch (e) {
            console.warn("[VIDEO] Advertencia al purgar VRAM:", e.message);
        }

        barActive = false; // Desactivar la magia
        
        // Restaurar logs
        console.log = originalConsole.log;
        console.warn = originalConsole.warn;
        console.error = originalConsole.error;
        console.info = originalConsole.info;

        // 6. Transcribir audio con Whisper
        let transcripcion = '';
        if (tieneAudio && fs.existsSync(audioPath)) {
            onEstado('Transcribiendo audio del video...');
            console.log('[VIDEO] Transcribiendo audio con Whisper...');
            try {
                const audioBuffer = fs.readFileSync(audioPath);
                transcripcion = await transcribirAudio(audioBuffer);
                const chars = transcripcion.text ? transcripcion.text.length : 0;
                console.log(`[VIDEO] Transcripción completada (${chars} chars)`);
            } catch (err) {
                console.warn(`[VIDEO] Error en transcripción: ${err.message}`);
            }
        }

        // contextoVisual ahora es un arreglo de objetos [{start, end, texto}]
        const contextoVisual = descripciones;
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

async function procesarVideo(videoBase64, onEstado = () => {}) {
    const tmpDir = path.join(os.tmpdir(), `arturo_video_b64_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const videoPath = path.join(tmpDir, 'input.mp4');

    try {
        const buffer = Buffer.from(videoBase64, 'base64');
        fs.writeFileSync(videoPath, buffer);
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        console.log(`[VIDEO] Guardado temporal B64: ${sizeMB} MB`);
        
        return await procesarVideoDesdeRuta(videoPath, onEstado);
    } finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {}
    }
}

module.exports = { procesarVideo, procesarVideoDesdeRuta };

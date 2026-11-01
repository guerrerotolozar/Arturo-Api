/**
 * whisperAdapter.js — STT con whisper.cpp como Microservicio HTTP.
 * Scale-to-Zero: Enciende el contenedor por Unix Socket, transcribe y lo apaga.
 */

const http = require('http');

function controlContainer(action) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'docker-proxy',
            port: 2375,
            path: `/v1.41/containers/Whisper-Service/${action}`,
            method: 'POST',
        };
        const req = http.request(options, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304) {
                resolve(true);
            } else {
                reject(new Error(`Docker API Error: ${res.statusCode}`));
            }
        });
        req.on('error', reject);
        req.end();
    });
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function waitForWhisper(maxRetries = 15) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await fetch('http://whisper:8080/');
            return true; // Si responde cualquier cosa, el puerto está abierto
        } catch (e) {
            // connection refused, server not up yet
        }
        await delay(1000);
    }
    throw new Error("Whisper no inició a tiempo.");
}

/**
 * Transcribe un buffer de audio WAV a texto usando HTTP.
 * @param {Buffer} audioBuffer - WAV 16kHz mono
 * @returns {Promise<string>}
 */
async function transcribirAudio(audioBuffer) {
    let containerStarted = false;
    try {
        console.log('[WHISPER] 🚀 Encendiendo contenedor bajo demanda...');
        await controlContainer('start');
        containerStarted = true;
        console.log('[WHISPER] ⏳ Esperando a que el modelo cargue en VRAM...');
        await waitForWhisper();
        console.log('[WHISPER] 🟢 Modelo listo. Enviando audio para inferencia...');

        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const formData = new FormData();
        formData.append('file', blob, 'audio.wav');
        formData.append('response_format', 'verbose_json');
        formData.append('language', 'auto');

        const response = await fetch('http://whisper:8080/inference', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Whisper HTTP error: ${response.status} ${response.statusText}`);
        }

        const rawText = await response.text();
        
        try {
            const data = JSON.parse(rawText);
            // Si funciona verbose_json, debe tener data.text y data.segments
            return {
                text: data.text ? data.text.trim() : "",
                segments: data.segments || []
            };
        } catch (e) {
            // Fallback a texto plano
            return { text: rawText.trim(), segments: [] };
        }
    } catch (err) {
        throw new Error(`Whisper falló: ${err.message}`);
    } finally {
        if (containerStarted) {
            console.log('[WHISPER] 🛑 Inferencia completada. Apagando contenedor para liberar VRAM...');
            try {
                await controlContainer('stop');
                console.log('[WHISPER] 🧹 VRAM liberada con éxito.');
            } catch (e) {
                console.error('[WHISPER] Error apagando contenedor:', e.message);
            }
        }
    }
}

module.exports = { transcribirAudio };
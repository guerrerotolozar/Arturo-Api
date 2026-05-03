/**
 * whisperAdapter.js — STT con whisper.cpp local.
 * Más rápido que el Python original. Corre en CPU sin GPU.
 */
const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { WHISPER_BIN, WHISPER_MODEL } = require('../config/env');



/**
 * Transcribe un buffer de audio WAV a texto.
 * @param {Buffer} audioBuffer - WAV 16kHz mono (el formato que envía el celular)
 * @returns {Promise<string>}
 */
async function transcribirAudio(audioBuffer) {
    const tmpPath = path.join(os.tmpdir(), `arturo_stt_${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, audioBuffer);

    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = spawn(WHISPER_BIN, [
                '-m', WHISPER_MODEL,
                '-f', tmpPath,
                '-l', 'auto',
                '--output-txt', '--no-timestamps', '--print-special', 'false'
            ]);
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return reject(new Error(`Whisper no disponible: ${e.message}`));
        }

        let texto = '';
        proc.stdout.on('data', d => texto += d.toString());

        // Capturar ENOENT y otros errores de spawn
        proc.on('error', err => {
            try { fs.unlinkSync(tmpPath); } catch {}
            reject(new Error(`Whisper no disponible: ${err.message}`));
        });

        proc.on('close', code => {
            try { fs.unlinkSync(tmpPath); } catch {}
            code === 0 ? resolve(texto.trim()) : reject(new Error(`Whisper exit ${code}`));
        });
    });
}

module.exports = { transcribirAudio };
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
        const proc = spawn(WHISPER_BIN, [
            '-m', WHISPER_MODEL,
            '-f', tmpPath,
            '-l', 'auto',
            '--output-txt', '--no-timestamps', '--print-special', 'false'
        ]);
        let texto = '';
        proc.stdout.on('data', d => texto += d.toString());
        proc.on('close', code => {
            // Cambiar esto:
            // unlinkSync(tmpPath);

            // Por esto (seguro):
            try {
                fs.unlinkSync(tmpPath);
            } catch (e) {
                console.warn(`No se pudo borrar temporal ${tmpPath}:`, e.message);
            }

            code === 0 ? resolve(texto.trim()) : reject(new Error(`Whisper exit ${code}`));
        });
    });
}

module.exports = { transcribirAudio };
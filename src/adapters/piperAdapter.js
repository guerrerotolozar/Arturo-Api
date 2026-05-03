/**
 * piperAdapter.js — TTS con Piper local.
 * Genera audio WAV a partir de texto. Corre en CPU, ~2s latencia.
 *
 * v2 (Post-Auditoría): YA NO auto-guarda en el vault. 
 * Si el caller (wsVoice.js) necesita persistir el audio, lo hace él.
 */
const { spawn } = require('child_process');
const { PIPER_BIN, PIPER_MODEL } = require('../config/env');

/**
 * Convierte texto a audio WAV.
 * @param {string} texto
 * @returns {Promise<Buffer>} audio PCM raw para enviar al cliente
 */
async function sintetizarVoz(texto) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const proc = spawn(PIPER_BIN, [
            '--model', PIPER_MODEL,
            '--output_raw'  // stdout = audio PCM raw
        ]);

        proc.stdin.write(texto);
        proc.stdin.end();

        proc.stdout.on('data', d => chunks.push(d));
        proc.stderr.on('data', d => console.warn(`[PIPER stderr] ${d.toString().trim()}`));
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(`Piper exit ${code}`));
            resolve(Buffer.concat(chunks));
        });
    });
}

module.exports = { sintetizarVoz };
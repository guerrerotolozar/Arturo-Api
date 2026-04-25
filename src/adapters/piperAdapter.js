/**
 * piperAdapter.js — TTS con Piper local.
 * Genera audio mp3 a partir de texto. Corre en CPU, ~2s latencia en hardware modesto.
 * La nota de voz se guarda en el vault para escucharla después.
 */
const { spawn }        = require('child_process');
const { writeFileSync } = require('fs');
const path              = require('path');
const os                = require('os');
const { escribirArchivo, asegurarDirectorio } = require('../repositories/vaultRepository');
const { VAULT_PATH }    = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');
const { PIPER_BIN, PIPER_MODEL } = require('../config/env');



/**
 * Convierte texto a audio WAV.
 * @param {string} texto
 * @returns {Promise<Buffer>} audio WAV para enviar al cliente
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
            const audioBuffer = Buffer.concat(chunks);

            // AUTOGUARDADO de notas de voz en el vault
            const ts      = obtenerTimestamp();
            const vocesDir = path.join(VAULT_PATH, 'Media', 'Voces');
            asegurarDirectorio(vocesDir);
            const audioPath = path.join(vocesDir, `voz_${Date.now()}.raw`);
            writeFileSync(audioPath, audioBuffer);
            console.log(`[PIPER] Nota de voz guardada: ${audioPath}`);

            resolve(audioBuffer);
        });
    });
}

module.exports = { sintetizarVoz };
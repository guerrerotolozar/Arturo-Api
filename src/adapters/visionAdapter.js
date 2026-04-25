/**
 * visionAdapter.js — Extrae texto y contexto de imágenes usando LLaVA/Qwen2-VL.
 *
 * INSTALAR modelo: ollama pull llava
 *
 * AUTOGUARDADO: Todo lo que Arturo "ve" se guarda automáticamente en el vault.
 *
 * CHANGELOG:
 *   - FIX: La detección de "ruta vs base64" usaba startsWith('/'), lo que hacía
 *     que base64 de JPEGs (que empiezan con '/9j/') se trataran como rutas de
 *     archivo → ENAMETOOLONG. Reemplazado por fs.existsSync(), que es la única
 *     forma semánticamente correcta de distinguir los dos casos.
 */

const fs   = require('fs');
const path = require('path');
const { OLLAMA_URL, OLLAMA_MODEL_VISION }                          = require('../config/env');
const { escribirArchivo, asegurarDirectorio } = require('../repositories/vaultRepository');
const { obtenerTimestamp }                    = require('../utils/dateUtils');
const { obtenerPrompt }                       = require('../utils/promptManager');
const { VAULT_PATH }                          = require('../config/env');


/**
 * Analiza una imagen y extrae todo el texto y contexto visible.
 *
 * @param {string} imagenInput - Ruta absoluta al archivo O string base64 puro
 * @param {string|null} instruccion - Qué debe extraer (default: descripción completa)
 * @returns {Promise<{texto: string, descripcion: string, guardadoEn: string}>}
 */
async function analizarImagen(imagenInput, instruccion = null) {
    let base64;

    // fs.existsSync es la única verificación correcta.
    // Cualquier heurística de strings (startsWith, longitud, regex) tiene falsos
    // positivos. Un base64 JPEG siempre empieza con '/9j/' → el check startsWith('/')
    // anterior lo confundía con una ruta Unix absoluta.
    if (fs.existsSync(imagenInput)) {
        base64 = fs.readFileSync(imagenInput).toString('base64');
    } else {
        base64 = imagenInput;
    }

    const promptDefecto = `Analiza esta imagen en detalle. Extrae:
1. TODO el texto visible exactamente como aparece, sin modificar nada.
2. Descripcion del contexto visual (tipo de documento, captura, fotografía).
3. Datos numéricos, fechas, nombres, URLs si los hay.
Responde en español.`;

    const prompt = instruccion ?? obtenerPrompt('vision.md', promptDefecto);

    console.log(`[VISION] Analizando con ${OLLAMA_MODEL_VISION}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min max

    let response;
    try {
        response = await fetch(OLLAMA_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                model:  OLLAMA_MODEL_VISION,
                prompt: prompt,
                images: [base64],
                stream: true
            }),
            signal: controller.signal
        });
    } catch (err) {
        clearTimeout(timeout);
        throw new Error(`Vision fetch failed: ${err.message}`);
    }

    if (!response.ok) {
        clearTimeout(timeout);
        throw new Error(`Vision LLM respondio ${response.status}`);
    }

    // Parsear stream NDJSON (misma lógica que ollamaAdapter)
    const respuestaAcumulada = [];
    try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lineas = buffer.split('\n');
            buffer = lineas.pop();

            for (const linea of lineas) {
                const limpia = linea.trim();
                if (!limpia) continue;
                try {
                    const chunk = JSON.parse(limpia);
                    if (chunk.response) respuestaAcumulada.push(chunk.response);
                    if (chunk.done) break;
                } catch { /* línea NDJSON mal formada — ignorar */ }
            }
        }
    } finally {
        clearTimeout(timeout);
    }

    const texto = respuestaAcumulada.join('').trim();
    if (!texto) throw new Error('Vision LLM devolvió respuesta vacía');

    // Autoguardado en Inbox
    const ts        = obtenerTimestamp();
    const nombre    = `Vision_${Date.now()}.md`;
    const inboxDir  = path.join(VAULT_PATH, 'Inbox');
    asegurarDirectorio(inboxDir);
    const rutaGuardado = path.join(inboxDir, nombre);

    const nota = [
        '---',
        `tipo: vision_capture`,
        `creado: ${ts}`,
        `fuente: visionAdapter`,
        '---',
        `# Captura Visual — ${ts}`,
        '',
        '## Texto extraído',
        '',
        texto,
        ''
    ].join('\n');

    escribirArchivo(rutaGuardado, nota);
    console.log(`[VISION] Guardado en Inbox/${nombre}`);

    return {
        texto,
        descripcion: texto.split('\n')[0],
        guardadoEn:  `Inbox/${nombre}`
    };
}

module.exports = { analizarImagen };
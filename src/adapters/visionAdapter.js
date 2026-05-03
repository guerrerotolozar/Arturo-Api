/**
 * visionAdapter.js — Extrae texto y contexto de imágenes usando VLM.
 *
 * v2 (Post-Auditoría):
 *   - Reutiliza llamarOllama() del ollamaAdapter (parsing NDJSON unificado).
 *   - YA NO auto-guarda en Inbox. El caller decide si persistir.
 *   - Fix original: fs.existsSync para distinguir ruta vs base64 (FIX JPEG '/9j/').
 */

const fs = require('fs');
const { OLLAMA_MODEL_VISION } = require('../config/env');
const { llamarOllama }        = require('./ollamaAdapter');
const { obtenerPrompt }       = require('../utils/promptManager');

/**
 * Analiza una imagen y extrae todo el texto y contexto visible.
 *
 * @param {string} imagenInput - Ruta absoluta al archivo O string base64 puro
 * @param {string|null} instruccion - Qué debe extraer (default: descripción completa)
 * @returns {Promise<{texto: string, descripcion: string}>}
 */
async function analizarImagen(imagenInput, instruccion = null) {
    let base64;

    // fs.existsSync es la única verificación correcta.
    // Un base64 JPEG siempre empieza con '/9j/' → el check startsWith('/')
    // lo confundía con una ruta Unix absoluta.
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

    // Reutilizar el motor unificado de streaming NDJSON
    const texto = await llamarOllama(prompt, OLLAMA_MODEL_VISION, null, [base64]);

    return {
        texto,
        descripcion: texto.split('\n')[0]
    };
}

module.exports = { analizarImagen };
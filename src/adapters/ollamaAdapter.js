/**
 * src/adapters/ollamaAdapter.js
 *
 * Única responsabilidad: hablar HTTP con Ollama.
 * No sabe nada de prompts, modelos específicos ni lógica de negocio.
 * Todo lo que cambia en el protocolo de Ollama se corrige aquí.
 *
 * NOTA TÉCNICA (Abril 2026):
 * Se usa stream:true + acumulación manual de tokens porque los modelos
 * de razonamiento (qwen3.5, etc.) entran en deadlock con stream:false.
 * El motor de inferencia de Ollama se bloquea internamente al intentar
 * buffear los tokens de "thinking" sin enviarlos, causando un timeout
 * de ~5 minutos seguido de un "fetch failed" en Node.
 */

const { OLLAMA_URL, OLLAMA_MODEL_EMBED } = require('../config/env');

const OLLAMA_TIMEOUT_MS = 120_000; // 2 minutos máx por llamada

/**
 * Envía un prompt a Ollama usando STREAMING y acumula la respuesta.
 * Compatible con modelos de razonamiento (thinking models) y clásicos.
 *
 * @param {string} prompt
 * @param {string} modelo    - Nombre del modelo Ollama (ej: "qwen3.5:4b")
 * @param {string|null} formato - "json" para forzar salida JSON estructurada
 * @returns {Promise<string>}
 */
async function llamarOllama(prompt, modelo, formato = null) {
    const body = { model: modelo, prompt, stream: true };
    if (formato) body.format = formato;

    // AbortController: si Ollama no termina en 2 min, cortamos limpio
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(OLLAMA_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  controller.signal
        });
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error(`Ollama timeout: "${modelo}" no respondió en ${OLLAMA_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    }

    if (!response.ok) {
        clearTimeout(timeout);
        throw new Error(`Ollama respondio ${response.status} para modelo "${modelo}"`);
    }

    // Parsear stream NDJSON línea por línea
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
            buffer = lineas.pop(); // última línea incompleta vuelve al buffer

            for (const linea of lineas) {
                const limpia = linea.trim();
                if (!limpia) continue;

                try {
                    const chunk = JSON.parse(limpia);

                    // Solo acumulamos el campo "response" (texto visible).
                    // Los tokens de "thinking" internos del modelo se descartan.
                    if (chunk.response) {
                        respuestaAcumulada.push(chunk.response);
                    }

                    if (chunk.done) break;
                } catch {
                    // Línea NDJSON mal formada — ignorar y seguir
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Ollama timeout (stream): "${modelo}" no completó en ${OLLAMA_TIMEOUT_MS / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }

    const resultado = respuestaAcumulada.join('').trim();
    if (!resultado) {
        throw new Error(`Ollama devolvió respuesta vacía para modelo "${modelo}"`);
    }
    return resultado;
}

/**
 * Genera el vector de embedding para un texto.
 * @param {string} texto
 * @returns {Promise<number[]>}
 */
async function generarEmbedding(texto) {
    const urlEmbed = OLLAMA_URL.replace('/generate', '/embeddings');
    const response = await fetch(urlEmbed, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: OLLAMA_MODEL_EMBED, prompt: texto })
    });

    if (!response.ok) {
        throw new Error(`Fallo al generar embedding: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding;
}

/**
 * Consulta los modelos disponibles en Ollama.
 * @returns {Promise<string[]>}
 */
async function obtenerModelos() {
    const baseUrl = OLLAMA_URL.replace('/api/generate', '');
    const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    if (!response.ok) throw new Error(`Ollama /api/tags respondio ${response.status}`);
    const data = await response.json();
    return (data.models || []).map(m => m.name);
}

module.exports = { llamarOllama, generarEmbedding, obtenerModelos };
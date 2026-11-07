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

// --- MUTEX PARA ENCOLAR PETICIONES A OLLAMA ---
// Ollama (especialmente con modelos grandes) sufre cuelgues o timeouts (UND_ERR_HEADERS_TIMEOUT)
// si recibe múltiples peticiones en paralelo. Esta "sala de espera" asegura que se procesen de a una.
let ollamaMutex = Promise.resolve();

/**
 * Envía un prompt a Ollama usando STREAMING y acumula la respuesta.
 * Compatible con modelos de razonamiento (thinking models) y clásicos.
 * Encola las peticiones para evitar cuelgues por paralelismo.
 *
 * @param {string} prompt
 * @param {string} modelo    - Nombre del modelo Ollama (ej: "qwen3.5:4b")
 * @param {string|null} formato - "json" para forzar salida JSON estructurada
 * @returns {Promise<string>}
 */
async function llamarOllama(prompt, modelo, formato = null, images = null, customOptions = null) {
    // Adquirir el ticket para la sala de espera
    let releaseMutex;
    const currentMutex = ollamaMutex;
    ollamaMutex = new Promise(resolve => { releaseMutex = resolve; });
    await currentMutex; // Esperar a que el anterior termine

    try {
        const { rejectTruncated, think, ...ollamaOpts } = customOptions || {};
        const body = { 
            model: modelo, 
            prompt, 
            stream: true,
            options: { num_ctx: 8192, num_predict: 8192, ...ollamaOpts }
        };
        if (typeof think === 'boolean') body.think = think;
        if (formato) body.format = formato;
        if (images) body.images = images;

    const response = await fetch(OLLAMA_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Ollama respondio ${response.status} para modelo "${modelo}"`);
    }

    // Parsear stream NDJSON línea por línea
    const respuestaAcumulada = [];
    let doneReason = null;
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

                if (chunk.done) {
                    doneReason = chunk.done_reason || null;
                    break;
                }
            } catch {
                // Línea NDJSON mal formada — ignorar y seguir
            }
        }
    }

        const resultado = respuestaAcumulada.join('').trim();
        if (!resultado) {
            throw new Error(`Ollama devolvió respuesta vacía para modelo "${modelo}"`);
        }
        if (rejectTruncated && doneReason === 'length') {
            throw new Error(`Respuesta truncada por límite de tokens (done_reason=length) en modelo "${modelo}"`);
        }
        return resultado;
    } finally {
        releaseMutex();
    }
}

/**
 * Genera el vector de embedding para un texto.
 * @param {string} texto
 * @returns {Promise<number[]>}
 */
async function generarEmbedding(texto) {
    const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
    const response = await fetch(`${baseUrl}/api/embed`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: OLLAMA_MODEL_EMBED, input: texto })
    });

    if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.embeddings) && data.embeddings.length > 0) {
            return data.embeddings[0];
        }
    }

    // Fallback a endpoint clásico /api/embeddings
    const urlEmbed = OLLAMA_URL.replace('/generate', '/embeddings');
    const fallbackRes = await fetch(urlEmbed, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: OLLAMA_MODEL_EMBED, prompt: texto })
    });

    if (!fallbackRes.ok) {
        throw new Error(`Fallo al generar embedding: ${fallbackRes.status}`);
    }

    const fallbackData = await fallbackRes.json();
    return fallbackData.embedding;
}

/**
 * Genera vectores de embedding en lote (batch) usando /api/embed de Ollama.
 * @param {string[]} textos
 * @returns {Promise<number[][]>}
 */
async function generarEmbeddingsBatch(textos) {
    if (!Array.isArray(textos) || textos.length === 0) return [];
    const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
    try {
        const response = await fetch(`${baseUrl}/api/embed`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ model: OLLAMA_MODEL_EMBED, input: textos })
        });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data.embeddings) && data.embeddings.length === textos.length) {
                return data.embeddings;
            }
        }
    } catch {
        // Fallback uno por uno si el batch falla
    }

    const resultados = [];
    for (const t of textos) {
        resultados.push(await generarEmbedding(t));
    }
    return resultados;
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

module.exports = { llamarOllama, generarEmbedding, generarEmbeddingsBatch, obtenerModelos };
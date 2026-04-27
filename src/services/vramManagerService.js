/**
 * src/services/vramManagerService.js
 *
 * Gestión inteligente de VRAM — Enrutador "Zero-Waste".
 *
 * Controla qué modelos de Ollama están cargados en GPU/RAM.
 * Solo el modelo Fast (gemma4) es residente permanente.
 * Los modelos pesados (Deep, Vision) se cargan bajo demanda
 * y se descargan al terminar para liberar VRAM.
 *
 * Usa la API de Ollama:
 *   - GET  /api/ps     → modelos actualmente cargados
 *   - POST /api/generate con keep_alive:"0" → descarga un modelo
 *   - POST /api/generate con prompt vacío   → precarga un modelo
 */

const { OLLAMA_URL, OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP, OLLAMA_MODEL_VISION } = require('../config/env');

// Base URL de Ollama (sin /api/generate)
const OLLAMA_BASE = OLLAMA_URL.replace('/api/generate', '');

/**
 * Obtiene la lista de modelos actualmente cargados en memoria.
 * @returns {Promise<Array<{name: string, size: number, expires_at: string}>>}
 */
async function obtenerModelosCargados() {
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/ps`, { method: 'GET' });
        if (!response.ok) throw new Error(`/api/ps respondió ${response.status}`);
        const data = await response.json();
        return data.models || [];
    } catch (err) {
        console.error(`[VRAM] Error consultando modelos cargados: ${err.message}`);
        return [];
    }
}

/**
 * Descarga un modelo de la VRAM/RAM de Ollama.
 * Usa keep_alive: "0" para forzar la descarga inmediata.
 *
 * @param {string} modelName - Nombre del modelo a descargar
 */
async function descargarModelo(modelName) {
    try {
        console.log(`[VRAM] Descargando modelo: ${modelName}...`);
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: '',
                keep_alive: '0',
                stream: false
            })
        });

        if (!response.ok) {
            console.warn(`[VRAM] ⚠️ No se pudo descargar ${modelName}: HTTP ${response.status}`);
        } else {
            console.log(`[VRAM] ✅ ${modelName} descargado de memoria.`);
        }
    } catch (err) {
        console.warn(`[VRAM] ⚠️ Error descargando ${modelName}: ${err.message}`);
    }
}

/**
 * Precarga un modelo en VRAM/RAM de Ollama.
 * Envía un prompt mínimo para que Ollama lo cargue sin generar respuesta real.
 *
 * @param {string} modelName - Nombre del modelo a precargar
 */
async function precargarModelo(modelName) {
    try {
        console.log(`[VRAM] Precargando modelo: ${modelName}...`);
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: 'test',
                stream: false,
                options: { num_predict: 1 } // Generar 1 solo token (carga rápida)
            })
        });

        if (!response.ok) {
            console.warn(`[VRAM] ⚠️ No se pudo precargar ${modelName}: HTTP ${response.status}`);
        } else {
            console.log(`[VRAM] ✅ ${modelName} cargado en memoria.`);
        }
    } catch (err) {
        console.warn(`[VRAM] ⚠️ Error precargando ${modelName}: ${err.message}`);
    }
}

/**
 * Operación atómica: descarga todos los modelos pesados y carga el modelo objetivo.
 * El modelo Fast NUNCA se descarga (es residente permanente).
 *
 * @param {string} targetModel - Modelo que se necesita cargar
 */
async function switchTo(targetModel) {
    const cargados = await obtenerModelosCargados();
    const nombresCargados = cargados.map(m => m.name);

    console.log(`[VRAM] Estado actual: [${nombresCargados.join(', ')}] → Objetivo: ${targetModel}`);

    // Si el modelo ya está cargado, no hacer nada
    if (nombresCargados.some(n => n.startsWith(targetModel.split(':')[0]))) {
        console.log(`[VRAM] ${targetModel} ya está en memoria. Sin cambios.`);
        return;
    }

    // Descargar modelos pesados (no el Fast)
    const modelosFast = OLLAMA_MODEL_FAST ? OLLAMA_MODEL_FAST.split(':')[0] : 'gemma4';
    for (const modelo of cargados) {
        const baseName = modelo.name.split(':')[0];
        if (baseName !== modelosFast) {
            await descargarModelo(modelo.name);
        }
    }

    // Cargar el modelo objetivo
    await precargarModelo(targetModel);
}

/**
 * Descarga TODOS los modelos pesados, dejando solo el Fast.
 * Útil después de una tarea pesada para liberar VRAM.
 */
async function liberarVRAM() {
    const cargados = await obtenerModelosCargados();
    const modelosFast = OLLAMA_MODEL_FAST ? OLLAMA_MODEL_FAST.split(':')[0] : 'gemma4';

    for (const modelo of cargados) {
        const baseName = modelo.name.split(':')[0];
        if (baseName !== modelosFast) {
            await descargarModelo(modelo.name);
        }
    }

    console.log('[VRAM] VRAM liberada — solo queda el modelo Fast.');
}

/**
 * Obtiene un resumen del estado actual de VRAM para debugging.
 * @returns {Promise<{modelos: Array, totalSize: string}>}
 */
async function obtenerEstadoVRAM() {
    const cargados = await obtenerModelosCargados();
    const totalBytes = cargados.reduce((sum, m) => sum + (m.size || 0), 0);
    const totalGB = (totalBytes / (1024 ** 3)).toFixed(2);

    return {
        modelos: cargados.map(m => ({
            nombre: m.name,
            tamaño: `${(m.size / (1024 ** 3)).toFixed(2)} GB`,
            expira: m.expires_at
        })),
        totalVRAM: `${totalGB} GB`
    };
}

module.exports = {
    obtenerModelosCargados,
    descargarModelo,
    precargarModelo,
    switchTo,
    liberarVRAM,
    obtenerEstadoVRAM
};

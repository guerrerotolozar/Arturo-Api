/**
 * Devuelve:
 *   - Estado de Ollama y modelos cargados
 *   - Conteo de notas en el vault
 *   - Estado de Tavily (si la key está configurada)
 *   - Uptime del proceso Node.js
 */

const { OLLAMA_URL, TAVILY_API_KEY, VAULT_PATH, OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP } = require('../config/env');
const { leerVaultRecursivo } = require('../services/vaultService');

/**
 * Consulta los modelos disponibles en Ollama.
 * Usa el endpoint /api/tags (estándar de Ollama).
 * @returns {Promise<string[]>} - Lista de nombres de modelos
 */
async function obtenerModelosOllama() {
    const baseUrl = OLLAMA_URL.replace('/api/generate', '');
    const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    if (!response.ok) throw new Error(`Ollama /api/tags respondió ${response.status}`);
    const data = await response.json();
    return (data.models || []).map(m => m.name);
}

/**
 * Handler para GET /api/status
 */
async function obtenerStatus(req, res) {
    const inicio = Date.now();

    // — Vault —
    let vault = { notas: 0, carpetas: new Set(), error: null };
    try {
        const notas = leerVaultRecursivo();
        vault.notas = notas.length;

        const path = require('path');
        notas.forEach(n => {
            const dir = path.dirname(n.ruta).replace(/\\/g, '/').replace(/^\//, '');
            if (dir && dir !== '.') vault.carpetas.add(dir.split('/')[0]);
        });
    } catch (err) {
        vault.error = err.message;
    }

    // — Ollama —
    let ollama = { ok: false, modelos: [], modeloFast: OLLAMA_MODEL_FAST, modeloDeep: OLLAMA_MODEL_DEEP, error: null };
    try {
        ollama.modelos = await obtenerModelosOllama();
        ollama.ok      = true;

        const fastDisponible = ollama.modelos.some(m => m.includes(OLLAMA_MODEL_FAST));
        const deepDisponible = ollama.modelos.some(m => m.includes(OLLAMA_MODEL_DEEP));

        if (!fastDisponible) console.warn(`[STATUS] Modelo FAST "${OLLAMA_MODEL_FAST}" no encontrado en Ollama.`);
        if (!deepDisponible) console.warn(`[STATUS] Modelo DEEP "${OLLAMA_MODEL_DEEP}" no encontrado en Ollama.`);

        ollama.fastDisponible = fastDisponible;
        ollama.deepDisponible = deepDisponible;
    } catch (err) {
        ollama.error = err.message;
    }

    // — Tavily —
    const tavily = {
        configurada: !!TAVILY_API_KEY,
        nota: TAVILY_API_KEY ? 'API Key presente en .env' : 'Sin API Key — búsqueda web deshabilitada'
    };

    // — Uptime —
    const uptimeSegundos = Math.floor(process.uptime());
    const horas   = Math.floor(uptimeSegundos / 3600);
    const minutos = Math.floor((uptimeSegundos % 3600) / 60);
    const segundos = uptimeSegundos % 60;
    const uptime  = `${horas}h ${minutos}m ${segundos}s`;

    const latencia = Date.now() - inicio;

    res.status(200).json({
        servidor:  'Arturo',
        estado:    ollama.ok ? 'operativo' : 'degradado',
        timestamp: new Date().toLocaleString('es-CO'),
        latencia_ms: latencia,
        uptime,
        vault: {
            notas:    vault.notas,
            carpetas: vault.carpetas.size,
            path:     VAULT_PATH,
            error:    vault.error
        },
        ollama,
        tavily
    });
}

module.exports = obtenerStatus;
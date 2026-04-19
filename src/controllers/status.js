const { obtenerModelos }                          = require('../adapters/ollamaAdapter');
const { TAVILY_API_KEY, VAULT_PATH,
        OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP }    = require('../config/env');
const { leerVaultRecursivo }                      = require('../repositories/vaultRepository');
const path = require('path');

async function obtenerStatus(req, res) {
    const t0 = Date.now();
    const notas  = leerVaultRecursivo();
    const carpetas = new Set(notas.map(n => path.dirname(n.ruta).replace(/\\/g,'/').split('/')[1]).filter(Boolean));
    let ollama = { ok: false, modelos: [], fastDisponible: false, deepDisponible: false, error: null };
    try {
        ollama.modelos = await obtenerModelos();
        ollama.ok = true;
        ollama.fastDisponible = ollama.modelos.some(m => m.includes(OLLAMA_MODEL_FAST));
        ollama.deepDisponible = ollama.modelos.some(m => m.includes(OLLAMA_MODEL_DEEP));
    } catch (e) { ollama.error = e.message; }
    const up = Math.floor(process.uptime());
    res.json({
        servidor: 'Arturo', estado: ollama.ok ? 'operativo' : 'degradado',
        timestamp: new Date().toLocaleString('es-CO'), latencia_ms: Date.now() - t0,
        uptime: `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${up%60}s`,
        vault: { notas: notas.length, carpetas: carpetas.size, path: VAULT_PATH },
        ollama, tavily: { configurada: !!TAVILY_API_KEY }
    });
}
module.exports = obtenerStatus;
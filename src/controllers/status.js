const { obtenerModelos } = require('../adapters/ollamaAdapter');
const { TAVILY_API_KEY, OLLAMA_MODEL, ARTURO_API_KEY_MOBILE, ARTURO_API_KEY_DESKTOP } = require('../config/env');
const { leerVaultRecursivo } = require('../repositories/vaultRepository');
const path = require('path');

async function obtenerStatus(req, res) {
    const t0 = Date.now();
    let ollama = { ok: false, modeloPrincipalDisponible: false };
    try {
        const modelos = await obtenerModelos();
        ollama.ok = true;
        ollama.modeloPrincipalDisponible = modelos.some(m => m.includes(OLLAMA_MODEL));
    } catch (e) {
        ollama.ok = false;
    }
    const up = Math.floor(process.uptime());

    // Respuesta base segura para healthcheck público / liveness probe
    const statusData = {
        servidor: 'Arturo',
        estado: ollama.ok ? 'operativo' : 'degradado',
        timestamp: new Date().toISOString(),
        latencia_ms: Date.now() - t0,
        uptime: `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${up%60}s`
    };

    // Solo exponer detalles del Vault y catálogo de modelos a clientes autenticados
    const clientKey = req.headers['x-arturo-key'];
    const esAutenticado = (clientKey && (clientKey === ARTURO_API_KEY_MOBILE || clientKey === ARTURO_API_KEY_DESKTOP));

    if (esAutenticado) {
        try {
            const notas = leerVaultRecursivo();
            const carpetas = new Set(notas.map(n => path.dirname(n.ruta).replace(/\\/g,'/').split('/')[1]).filter(Boolean));
            statusData.vault = { notas: notas.length, carpetas: carpetas.size };
            statusData.ollama = { ...ollama, modelos: await obtenerModelos().catch(() => []) };
            statusData.tavily = { configurada: !!TAVILY_API_KEY };
        } catch (_) {}
    }

    res.json(statusData);
}

module.exports = obtenerStatus;
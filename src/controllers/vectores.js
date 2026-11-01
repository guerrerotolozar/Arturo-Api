/**
 * src/controllers/vectores.js
 *
 * Thin controller para la base de datos vectorial (LanceDB).
 * Endpoints para sincronizar la Bóveda y consultar el estado.
 *
 * Rutas:
 *   POST /IA/vectores/sync   → Sincroniza la Bóveda a ChromaDB
 *   GET  /IA/vectores/estado  → Estado actual de la DB vectorial
 *   GET  /IA/vram/estado      → Estado actual de VRAM de Ollama
 *   POST /IA/vram/liberar     → Libera VRAM (descarga modelos pesados)
 */

const { sincronizarBoveda, obtenerEstadoVectorial } = require('../use-cases/vaultIndexer');
const { buscarSemanticamente } = require('../repositories/vectorRepository');

/**
 * POST /IA/vectores/sync
 * Body opcional: { forzarReset: true, carpeta: "NUCLEO" }
 */
async function syncVectoresController(req, res) {
    try {
        const { forzarReset = false, carpeta = null } = req.body || {};

        console.log(`[CTRL vectores/sync] Iniciando sincronización... (reset: ${forzarReset}, carpeta: ${carpeta || 'TODA'})`);

        const resultado = await sincronizarBoveda({
            forzarReset,
            carpeta,
            onProgress: (msg) => console.log(`[SYNC] ${msg}`)
        });

        res.json(resultado);
    } catch (err) {
        console.error(`[CTRL vectores/sync] Error: ${err.message}`);
        res.status(500).json({ exito: false, error: err.message });
    }
}

/**
 * GET /IA/vectores/estado
 */
async function estadoVectoresController(req, res) {
    try {
        const estado = await obtenerEstadoVectorial();
        res.json(estado);
    } catch (err) {
        res.status(500).json({ disponible: false, error: err.message });
    }
}


async function getRagContextController(req, res) {
    try {
        const query = req.query.q || "componentes de la torre";
        const resLance = await buscarSemanticamente(query, 5, []);
        res.json({ exito: true, query, resultados: resLance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    syncVectoresController,
    estadoVectoresController,
    getRagContextController
};

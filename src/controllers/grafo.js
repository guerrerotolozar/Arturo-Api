/**
 * Controlador del Grafo 3D.
 *
 * GET /api/grafo       → JSON de nodos y enlaces para Three.js / Force-Graph
 * GET /api/grafo/stats → Estadísticas: hubs, huérfanos, conteo por carpeta
 */

const { generarGrafoJSON, obtenerEstadisticasGrafo } = require('../services/vaultService');

function obtenerGrafo(req, res) {
    console.log(`[IA GRAFO] Generando red neuronal 3D...`);
    try {
        const datosGrafo = generarGrafoJSON();
        res.status(200).json(datosGrafo);
    } catch (err) {
        console.error(`[GRAFO ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al mapear el cerebro.' });
    }
}

function obtenerStatsGrafo(req, res) {
    console.log(`[IA GRAFO STATS] Calculando estadísticas del grafo...`);
    try {
        const stats = obtenerEstadisticasGrafo();
        res.status(200).json(stats);
    } catch (err) {
        console.error(`[GRAFO STATS ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al calcular estadísticas del grafo.' });
    }
}

module.exports = { obtenerGrafo, obtenerStatsGrafo };
const { generarGrafoJSON, obtenerEstadisticasGrafo } = require('../services/graphService');

function obtenerGrafo(req, res) {
    try { res.status(200).json(generarGrafoJSON()); }
    catch (err) { res.status(500).json({ error: err.message }); }
}
function obtenerStatsGrafo(req, res) {
    try { res.status(200).json(obtenerEstadisticasGrafo()); }
    catch (err) { res.status(500).json({ error: err.message }); }
}
module.exports = { obtenerGrafo, obtenerStatsGrafo };
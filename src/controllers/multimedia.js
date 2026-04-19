// src/controllers/multimedia.js
const { procesarVideo } = require('../use-cases/multimediaPipelineUseCase');

async function procesarVideoHandler(req, res) {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Falta la URL del video.' });
    res.status(202).json({ mensaje: 'Procesando video en segundo plano...', url });
    procesarVideo(url).catch(err => console.error(`[MULTIMEDIA ERROR] ${err.message}`));
}
module.exports = procesarVideoHandler;

// En index.js:
// app.post('/IA/multimedia', require('./src/controllers/multimedia'));
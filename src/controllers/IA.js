const { consultaHibrida } = require('../use-cases/consultaHibridaUseCase');

async function consultaIA(req, res) {
    const { pregunta } = req.body;
    if (!pregunta?.trim()) return res.status(400).json({ error: 'Falta la pregunta.' });
    console.log(`[IA] "${pregunta}"`);
    try {
        const resultado = await consultaHibrida(pregunta);
        res.status(200).json({ pregunta, ...resultado });
    } catch (err) {
        console.error(`[IA ERROR] ${err.message}`);
        const status = err.message.includes('Ollama') ? 503 : 500;
        res.status(status).json({ error: err.message });
    }
}
module.exports = consultaIA;
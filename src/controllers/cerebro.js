const { ingestionIdea } = require('../use-cases/ingestionIdeaUseCase');

function webhookCerebro(req, res) {
    const { idea } = req.body;
    if (!idea) return res.status(400).send('Falta la idea.');
    res.status(200).json({ mensaje: 'Idea recibida. Arturo procesando...', idea_original: idea });
    ingestionIdea(idea).catch(err => console.error(`[CEREBRO ERROR] ${err.message}`));
}
module.exports = webhookCerebro;
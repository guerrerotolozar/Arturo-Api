/**
 * Controlador del Webhook del Segundo Cerebro.
 * Ruta: POST /webhook/cerebro
 * Motor: phi3 (FAST) — Inserción rápida de ideas al vault.
 */

const { clasificarIdea } = require('../services/llmService');
const { obtenerCategorias, escribirIdeaEnVault } = require('../services/vaultService');
const { obtenerTimestamp } = require('../utils/dateUtils');

/**
 * Handler para POST /webhook/cerebro
 * Recibe una idea, responde inmediato, y clasifica + guarda en segundo plano.
 */
function webhookCerebro(req, res) {
    const { idea } = req.body;

    if (!idea) return res.status(400).send('Falta la idea, Ronald.');

    // Responder de inmediato (evita timeout en Postman)
    res.status(200).json({
        mensaje: "Idea recibida. Arturo está procesando...",
        idea_original: idea
    });

    // Procesar en segundo plano con phi3 vía API HTTP
    console.log(`[LOG] Procesando idea: "${idea}"`);

    const categorias = obtenerCategorias();

    clasificarIdea(idea, categorias)
        .then(categoria => {
            const timestamp = obtenerTimestamp();
            escribirIdeaEnVault(categoria, idea, timestamp);
            console.log(`[SUCCESS] Idea guardada en [[${categoria}]]`);
        })
        .catch(err => {
            console.error(`[ERROR] Fallo al clasificar: ${err.message}`);
        });
}

module.exports = webhookCerebro;

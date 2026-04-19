/**
 * src/controllers/IAfast.js — Solo HTTP.
 *
 * Antes: ~100 líneas con lógica de herramientas, if/else, prompts, LLM directo.
 * Ahora: validar → delegar al use-case → serializar respuesta.
 */

const { ejecutarAgenteRapido } = require('../use-cases/agenteRapidoUseCase');
const { OLLAMA_MODEL_FAST } = require('../config/env');

async function consultaIAFast(req, res) {
    const { pregunta } = req.body;
    if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta.' });

    console.log(`\n[AGENTE] Peticion: "${pregunta}"`);

    try {
        const resultado = await ejecutarAgenteRapido(pregunta);

        res.status(200).json({
            pregunta,
            respuesta:              resultado.respuesta,
            motor_usado:            `${OLLAMA_MODEL_FAST} (Modo Agente)`,
            herramientas_activadas: resultado.herramientas,
            plan_interno:           resultado.plan
        });

    } catch (err) {
        console.error(`[AGENTE ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo en la ejecucion del agente.', detalle: err.message });
    }
}

module.exports = consultaIAFast;
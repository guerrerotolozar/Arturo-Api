/**
 * src/use-cases/agenteRapidoUseCase.js
 *
 * Orquesta el agente Tool-Calling de Arturo.
 * No sabe nada de HTTP — recibe datos, devuelve datos.
 *
 * ANTES (IAfast.js, controlador):
 *   - if/else por cada herramienta (OCP violation)
 *   - `llamarOllama` hardcodeado con modelo directo
 *   - prompt de síntesis inline
 *
 * AHORA:
 *   - Lee las herramientas del registro dinámico (tools/index.js)
 *   - Agregar herramienta = crear archivo *Tool.js, zero cambios aquí
 *   - El prompt de síntesis vive en este use-case, no en el controlador
 */

const { orquestarTareas, consultarIAFast, sintetizarRespuestaAgente } = require('../services/llmService');
const { toolMap } = require('../tools');

/**
 * Ejecuta el agente para una pregunta dada.
 *
 * @param {string} pregunta
 * @returns {Promise<{respuesta: string, herramientas: string[], plan: Array}>}
 */
async function ejecutarAgenteRapido(pregunta) {
    // 1. El LLM planifica qué herramientas usar
    const plan = await orquestarTareas(pregunta);
    console.log(`[AGENTE] Plan:`, JSON.stringify(plan.tareas));

    let datosAcumulados = '';
    const herramientasUsadas = [];

    // 2. JavaScript ejecuta cada herramienta determinísticamente
    for (const tarea of plan.tareas) {
        if (tarea.herramienta === 'respuesta_directa') {
            console.log(`[AGENTE] LLM decidió ignorar herramientas (respuesta_directa).`);
            const respuesta = await consultarIAFast(pregunta);
            return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
        }

        const tool = toolMap.get(tarea.herramienta);

        if (!tool) {
            // Herramienta no encontrada → respuesta directa
            console.log(`[AGENTE] Herramienta "${tarea.herramienta}" no encontrada. Modo chat directo.`);
            const respuesta = await consultarIAFast(pregunta);
            return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
        }

        try {
            const resultado = await tool.ejecutar(tarea.parametros || {});
            datosAcumulados += resultado.resumen + '\n';
            herramientasUsadas.push(tool.nombre);
        } catch (err) {
            console.warn(`[AGENTE] Tool "${tool.nombre}" fallo: ${err.message}`);
            datosAcumulados += `(Error en ${tool.nombre}: ${err.message})\n`;
        }
    }

    // 3. Si no se usó ninguna tool real → charla directa
    if (herramientasUsadas.length === 0) {
        const respuesta = await consultarIAFast(pregunta);
        return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
    }

    // 4. Síntesis final — el LLM humaniza los datos crudos
    const respuesta = await sintetizarRespuestaAgente(pregunta, datosAcumulados);

    return { respuesta, herramientas: herramientasUsadas, plan: plan.tareas };
}

module.exports = { ejecutarAgenteRapido };
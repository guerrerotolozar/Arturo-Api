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
 * Ejecuta el agente para una pregunta dada e informa progreso.
 *
 * @param {string} pregunta
 * @param {string} [origen]
 * @param {function} [onProgress] - Callback para streaming de estados funcionales
 * @returns {Promise<{respuesta: string, herramientas: string[], plan: Array}>}
 */
async function ejecutarAgenteRapido(pregunta, origen = '', onProgress = () => {}, historial = []) {
    // 1. El LLM planifica qué herramientas usar
    onProgress('Planeando...');
    const tPlanStart = Date.now();
    const plan = await orquestarTareas(pregunta, historial);
    console.log(`[AGENTE] Plan generado ✔️ [ ${((Date.now() - tPlanStart)/1000).toFixed(2)}s ]`, JSON.stringify(plan.tareas));

    let datosAcumulados = '';
    let respuestaDeep = null;  // Si deep_analysis se ejecuta, su resultado va aquí
    const herramientasUsadas = [];

    // 2. JavaScript ejecuta cada herramienta determinísticamente
    for (const tarea of plan.tareas) {
        if (tarea.herramienta === 'respuesta_directa') {
            // v7.7: Si ya hay datos acumulados de herramientas previas (ej: vault_list → respuesta_directa),
            // NO cortar al modo directo — dejar que el sintetizador use esos datos.
            if (datosAcumulados.length > 0) {
                console.log(`[AGENTE] respuesta_directa con datos previos → delegando al sintetizador.`);
                break; // Sale del loop → va al paso 5 (síntesis con datosAcumulados)
            }
            console.log(`[AGENTE] LLM decidió ignorar herramientas (respuesta_directa).`);
            onProgress('Redactando respuesta...');
            const tDirStart = Date.now();
            const respuesta = await consultarIAFast(pregunta, origen, historial);
            console.log(`[AGENTE] Respuesta directa ✔️ [ ${((Date.now() - tDirStart)/1000).toFixed(2)}s ]`);
            return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
        }

        const tool = toolMap.get(tarea.herramienta);

        if (!tool) {
            // Herramienta no encontrada → respuesta directa
            console.log(`[AGENTE] Herramienta "${tarea.herramienta}" no encontrada. Modo chat directo.`);
            onProgress('Redactando respuesta...');
            const tDirStart = Date.now();
            const respuesta = await consultarIAFast(pregunta, origen, historial);
            console.log(`[AGENTE] Respuesta directa fallback ✔️ [ ${((Date.now() - tDirStart)/1000).toFixed(2)}s ]`);
            return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
        }

        try {
            onProgress(`Invocando ${tarea.herramienta}...`);
            const tToolStart = Date.now();

            // v6.2: Inyección de resultados encadenados.
            // Si el LLM planificó: [tavily_search] → [vault_append con {{resultado_anterior}}],
            // JavaScript reemplaza el placeholder con los datos reales de la tool anterior.
            if (tarea.parametros) {
                for (const key in tarea.parametros) {
                    if (typeof tarea.parametros[key] === 'string') {
                        if (tarea.parametros[key] === '{{resultado_anterior}}') {
                            tarea.parametros[key] = datosAcumulados;
                        } else if (tarea.parametros[key] === '{{texto_del_usuario}}') {
                            tarea.parametros[key] = pregunta;
                        }
                    }
                }
            }

            const resultadoHerramienta = await tool.ejecutar(tarea.parametros, onProgress);
            console.log(`[TOOL ${tarea.herramienta}] Completada ✔️ [ ${((Date.now() - tToolStart)/1000).toFixed(2)}s ]`);
            
            // v7.6: Detectar si la herramienta reportó fallo (ej: vault_move no encontró el archivo)
            if (resultadoHerramienta.datos?.exito === false) {
                onProgress(`⚠️ ${tarea.herramienta}: ${resultadoHerramienta.resumen}`);
                console.log(`[TOOL ${tarea.herramienta}] Reportó fallo controlado: ${resultadoHerramienta.resumen}`);
            } else {
                onProgress(`✅ ${tarea.herramienta} ejecutada`);
            }

            herramientasUsadas.push(tarea.herramienta);
            datosAcumulados += `\n[Herramienta: ${tarea.herramienta}]\n${JSON.stringify(resultadoHerramienta.resumen)}\n`;

            // Si deep_analysis fue ejecutado, su resultado ya ES la respuesta final.
            // No necesita pasar por el sintetizador Fast (sería redundante y lento).
            if (tarea.herramienta === 'deep_analysis') {
                respuestaDeep = resultadoHerramienta.resumen;
            }

        } catch (err) {
            console.error(`[AGENTE] Tool "${tarea.herramienta}" fallo: ${err.message}`);
            onProgress(`⚠️ ${tarea.herramienta} falló`);
            datosAcumulados += `\n[Herramienta fallida: ${tarea.herramienta}] Error: ${err.message}\n`;
        }
    }

    // 3. Si no se usó ninguna tool real → charla directa
    if (herramientasUsadas.length === 0) {
        onProgress('Redactando respuesta...');
        const tDirStart = Date.now();
        const respuesta = await consultarIAFast(pregunta, origen, historial);
        console.log(`[AGENTE] Respuesta directa fallback ✔️ [ ${((Date.now() - tDirStart)/1000).toFixed(2)}s ]`);
        return { respuesta, herramientas: ['respuesta_directa'], plan: plan.tareas };
    }

    // 4. Si deep_analysis ya generó la respuesta, usarla directamente
    if (respuestaDeep) {
        console.log(`[AGENTE] Usando respuesta del modelo profundo (skip sintetizador Fast)`);
        return { respuesta: respuestaDeep, herramientas: herramientasUsadas, plan: plan.tareas };
    }

    // 5. Síntesis final — el LLM Fast humaniza los datos crudos
    onProgress('Sintetizando información...');
    const tSynthStart = Date.now();
    const respuesta = await sintetizarRespuestaAgente(pregunta, datosAcumulados, origen, historial);
    console.log(`[AGENTE] Síntesis final completada ✔️ [ ${((Date.now() - tSynthStart)/1000).toFixed(2)}s ]`);

    return { respuesta, herramientas: herramientasUsadas, plan: plan.tareas };
}

module.exports = { ejecutarAgenteRapido };
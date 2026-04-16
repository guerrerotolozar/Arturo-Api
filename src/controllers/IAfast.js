/**
 * Controlador de IA Fast — Ahora funciona como AGENTE AUTÓNOMO.
 * Motor: qwen2.5:1.5B (Orquestador)
 */

const { orquestarTareas, consultarIAFast, llamarOllama } = require('../services/llmService');
const { buscarEnWeb } = require('../services/searchService');
const { buscarContexto } = require('../services/vaultService');

async function consultaIAFast(req, res) {
    const { pregunta } = req.body;
    if (!pregunta) return res.status(400).send('Falta la pregunta rápida.');

    console.log(`\n[AGENTE] Analizando petición: "${pregunta}"`);

    try {
        // 1. Qwen piensa y decide qué herramientas usar (Retorna JSON)
        const plan = await orquestarTareas(pregunta);
        console.log(`[AGENTE] Plan de Qwen:`, JSON.stringify(plan.tareas));

        let respuestaFinal = "";
        let herramientasUsadas = [];

        // 2. JavaScript ejecuta las herramientas de forma determinista (sin alucinar)
        for (const tarea of plan.tareas) {
            
            if (tarea.herramienta === 'calculadora') {
                try {
                    // Usamos el motor V8 de Node para calcular, cero errores matemáticos
                    // Reemplazamos 'x' por '*' y '^' por '**' para que JS entienda
                    const formulaLimpia = tarea.parametros.formula.replace(/x/gi, '*').replace(/\^/g, '**');
                    const resultadoMath = new Function('return ' + formulaLimpia)();
                    
                    respuestaFinal += `El resultado de la operación es: ${resultadoMath}\n`;
                    herramientasUsadas.push('Calculadora JS');
                    console.log(`[TOOL] Calculadora ejecutada: ${formulaLimpia} = ${resultadoMath}`);
                } catch (e) {
                    respuestaFinal += `Error calculando la fórmula: ${tarea.parametros.formula}\n`;
                }
            } 
            
            else if (tarea.herramienta === 'tavily_search') {
                const web = await buscarEnWeb(tarea.parametros.query);
                const resumen = web.answer || (web.results[0] ? web.results[0].content : 'Sin datos');
                respuestaFinal += `Datos de internet: ${resumen}\n`;
                herramientasUsadas.push('Tavily Search');
            }
            
            else if (tarea.herramienta === 'vault_search') {
                console.log(`[TOOL] Leyendo el Cerebro de Ronald buscando: "${tarea.parametros.query}"`);
                const fragmentos = await buscarContexto(tarea.parametros.query);
                
                let resumenVault = "Datos encontrados en mis notas locales:\n";
                if (fragmentos.length > 0) {
                    fragmentos.forEach(f => {
                        // Le pasamos la fuente y el pedazo de texto a Qwen
                        resumenVault += `- Fuente [${f.fuente}]: ${f.texto}\n`;
                    });
                } else {
                    resumenVault += "No encontré nada escrito sobre esto en mi base de datos.\n";
                }
                
                respuestaFinal += resumenVault;
                herramientasUsadas.push('Vault Search');
            }
            
            else {
                // Fallback: Si es solo charla, le responde normal
                const chat = await consultarIAFast(pregunta);
                respuestaFinal += chat;
                herramientasUsadas.push('Chat Directo');
            }
        }

      // 3. Síntesis de la IA ---
        if (herramientasUsadas.includes('Tavily Search') || herramientasUsadas.includes('Calculadora JS') || herramientasUsadas.includes('Vault Search')) {
            console.log(`[AGENTE] Traduciendo y adaptando respuesta para Ronald...`);
            
            const promptSintesis = `Traduce y adapta la siguiente información para responderle a Ronald.

        REGLAS ESTRICTAS:
        1. DEBES responder EXCLUSIVAMENTE en español. Cero inglés.
        2. Usa un tono de asistente cercano, directo y con jerga local colombiana (ej. "Parce", "Pille", "Listo").
        3. Solo entrega la respuesta final, no digas "Aquí tienes la traducción" ni expliques qué hiciste.
        Datos crudos que debes comunicar: 
        "${respuestaFinal.trim()}"

        Lo que preguntó Ronald: 
        "${pregunta}"

        Tu respuesta directa en español:`;
                        
            respuestaFinal = await llamarOllama(promptSintesis, "qwen2.5:1.5b");
        }

        // 4. Devolvemos el resultado a Postman/Frontend
        res.status(200).json({
            pregunta: pregunta,
            respuesta: respuestaFinal.trim(),
            motor_usado: "qwen2.5:1.5b (Modo Agente)",
            herramientas_activadas: herramientasUsadas,
            plan_interno: plan.tareas
        });

    } catch (err) {
        console.error(`[AGENTE ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo en la ejecución del agente.' });
    }
}

module.exports = consultaIAFast;
/**
 * src/tools/deepAnalysisTool.js — Escalado dinámico al modelo de razonamiento profundo.
 *
 * ¿Por qué existe esto?
 * ─────────────────────
 * El modelo Fast (gemma4:e4b) es rápido pero limitado para problemas
 * multidimensionales (planificación financiera, pros/contras complejos,
 * decisiones de vida con múltiples variables).
 *
 * Esta herramienta es un "puente" que el orquestador puede invocar cuando
 * detecta que el problema necesita más poder de razonamiento. Delega la
 * respuesta al modelo Deep (qwen3.5:9b) con todo el contexto acumulado
 * (incluyendo recuerdos del vault y datos de herramientas previas).
 *
 * FILOSOFÍA: No se hardcodea cuándo escalar. El orquestador (un LLM)
 * decide si el problema amerita análisis profundo. Solo ponemos el puente.
 */

const { llamarOllama } = require('../adapters/ollamaAdapter');
const { obtenerPrompt } = require('../utils/promptManager');
const { OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');

module.exports = {
    nombre: 'deep_analysis',
    descripcion: 'Para problemas complejos que requieren razonamiento profundo: análisis financiero, '
        + 'comparaciones con múltiples variables, planificación de vida, pros/contras, decisiones estratégicas. '
        + 'Parametros: "pregunta" (la pregunta original de Ronald), '
        + '"contexto" (datos acumulados de herramientas previas o del vault, usar {{resultado_anterior}} si hay).',

    /**
     * @param {{ pregunta: string, contexto?: string }} params
     * @param {function} onProgress
     * @returns {{ resumen: string, datos: object }}
     */
    async ejecutar({ pregunta, contexto = '' }, onProgress = () => {}) {
        if (!pregunta) throw new Error('deepAnalysisTool: falta el campo "pregunta"');

        console.log(`[TOOL deep_analysis] Escalando al modelo profundo...`);
        onProgress('Pensando en profundidad...');

        const perfilRonald = PERFIL_RONALD || '';
        
        const prompt = `Eres Arturo V7, el Segundo Cerebro de Ronald. ${perfilRonald}

CONTEXTO ACUMULADO (información de notas y herramientas previas):
${contexto || 'Sin contexto previo.'}

PETICIÓN DE RONALD:
"${pregunta}"

INSTRUCCIONES:
- Analiza el problema desde múltiples ángulos.
- Si hay datos numéricos, haz cálculos o estimaciones concretas.
- Sé estratégico: prioriza lo que Ronald NECESITA saber, no todo lo que podrías decir.
- Si encuentras datos del vault en el contexto, conéctalos con la situación actual.
- Estructura tu respuesta con puntos clave claros.
- Máximo 4-5 puntos principales. Nada de ensayos.
- Tono: directo, empático, como un amigo que entiende tu situación.

ANÁLISIS:`;

        const tStart = Date.now();
        const respuesta = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);
        
        console.log(`[TOOL deep_analysis] Análisis profundo completado ✔️ [ ${elapsed}s ]`);
        onProgress('✅ Análisis profundo completado');

        return {
            resumen: respuesta,
            datos: { modelo_usado: OLLAMA_MODEL_DEEP, tiempo_s: elapsed }
        };
    }
};

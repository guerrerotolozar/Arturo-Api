/**
 * src/tools/deepAnalysisTool.js — Escalado dinámico al modelo de razonamiento.
 *
 * V8.5 (Post-Auditoría):
 *   - Respeta DEEP_ANALYSIS_ENABLED de .env
 *     → true:  intenta modelo Deep primero, fallback a Fast si falla
 *     → false: va directo al Fast con prompt enriquecido (0 tiempo perdido)
 *   - Cuando llegue la RTX 5060 Ti: solo cambiar DEEP_ANALYSIS_ENABLED=true en .env
 *   - Siempre recibe datosAcumulados gracias al fix en agenteRapidoUseCase
 */

const { llamarOllama } = require('../adapters/ollamaAdapter');
const { OLLAMA_MODEL_DEEP, OLLAMA_MODEL_FAST, PERFIL_RONALD, DEEP_ANALYSIS_ENABLED } = require('../config/env');
const { switchTo, liberarVRAM } = require('../services/vramManagerService');

module.exports = {
    nombre: 'deep_analysis',
    descripcion: 'Activa el modelo de razonamiento profundo para cualquier pregunta que necesite PENSAR: '
        + 'análisis con múltiples variables, cálculos, explicaciones técnicas detalladas, toma de decisiones, '
        + 'planificación, pros/contras, o cuando la respuesta rápida no es suficiente. '
        + 'Parametros: "pregunta" (la pregunta original de Ronald), '
        + '"contexto" (datos acumulados de herramientas previas o del vault, usar {{resultado_anterior}} si hay).',

    async ejecutar({ pregunta, contexto = '' }, onProgress = () => {}) {
        if (!pregunta) throw new Error('deepAnalysisTool: falta el campo "pregunta"');

        const perfilRonald = PERFIL_RONALD || '';
        
        const promptBase = `Eres Arturo V8.5, el Segundo Cerebro de Ronald. ${perfilRonald}

DATOS DISPONIBLES (de herramientas ejecutadas previamente — ÚSALOS):
${contexto || 'Sin datos previos.'}

PETICIÓN DE RONALD:
"${pregunta}"

INSTRUCCIONES:
- PRIMERO revisa los DATOS DISPONIBLES arriba. Si hay números, TDP, consumos, especificaciones: ÚSALOS para calcular.
- NO le pidas a Ronald datos que ya están en los datos disponibles.
- Analiza el problema desde múltiples ángulos.
- Si hay datos numéricos, haz cálculos concretos con los números reales.
- Estructura tu respuesta con puntos clave claros.
- Tono: directo, empático, como un amigo que entiende tu situación.

ANÁLISIS:`;

        const tStart = Date.now();

        // ── Intento con Modelo Deep (solo si está habilitado) ────────────
        if (DEEP_ANALYSIS_ENABLED) {
            try {
                console.log(`[TOOL deep_analysis] Escalando al modelo profundo (${OLLAMA_MODEL_DEEP})...`);
                onProgress('Pensando en profundidad...');

                await switchTo(OLLAMA_MODEL_DEEP);
                const respuesta = await llamarOllama(promptBase, OLLAMA_MODEL_DEEP);
                const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);

                console.log(`[TOOL deep_analysis] Modelo profundo completado ✔️ [ ${elapsed}s ]`);
                onProgress('✅ Análisis profundo completado');
                await liberarVRAM();

                return {
                    resumen: respuesta,
                    datos: { modelo_usado: OLLAMA_MODEL_DEEP, tiempo_s: elapsed }
                };
            } catch (err) {
                const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);
                console.warn(`[TOOL deep_analysis] Modelo profundo falló (${elapsed}s): ${err.message}`);
                try { await liberarVRAM(); } catch (_) {}
            }
        } else {
            console.log(`[TOOL deep_analysis] DEEP_ANALYSIS_ENABLED=false → directo al Fast enriquecido`);
        }

        // ── Fallback/Directo: Fast con prompt de razonamiento ────────────
        onProgress('Analizando...');
        const tFallback = Date.now();

        const promptEnriquecido = `${promptBase}

NOTA IMPORTANTE: Esfuérzate al máximo en RAZONAR. Si hay números en los DATOS DISPONIBLES, 
haz los cálculos paso a paso. Usa los datos reales, no pidas lo que ya tienes.`;

        const respuesta = await llamarOllama(promptEnriquecido, OLLAMA_MODEL_FAST);
        const elapsed = ((Date.now() - tFallback) / 1000).toFixed(2);

        console.log(`[TOOL deep_analysis] Fast enriquecido completado ✔️ [ ${elapsed}s ]`);
        onProgress('✅ Análisis completado');

        return {
            resumen: respuesta,
            datos: { modelo_usado: `${OLLAMA_MODEL_FAST} (análisis)`, tiempo_s: elapsed }
        };
    }
};

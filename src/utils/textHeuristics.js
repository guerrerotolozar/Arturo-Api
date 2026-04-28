/**
 * textHeuristics.js
 * 
 * Centraliza la lógica de Regex y heurísticas de texto plano.
 * Así se mantiene al llmService.js completamente aislado y enfocado solo en Ollama.
 */

const SENALES_WEB = [
    /busca en internet/i, /busca en la web/i, /googlea/i,
    /hoy en dia/i, /precio[s]? actual/i, /precio[s]? hoy/i,
    /cuanto vale[n]? hoy/i, /marcas actuales/i, /ahora mismo/i,
    /noticias de hoy/i, /cotizacion actual/i, /tasa de cambio/i,
];

const PATRONES_SIMPLE = [
    /^[\d\s\+\-\*\/\(\)\^%=.,]+\??\s*$/, /\d+\s*[\+\-\*\/x]\s*\d+/,
    /^(hola|buenas|hey|quiubo|hi)[^a-z]*$/i,
    /^(gracias|listo|ok|perfecto|dale)[^a-z]*$/i,
];

function esPreguntaSimple(pregunta) {
    if (PATRONES_SIMPLE.some(p => p.test(pregunta.trim()))) return true;
    const palabras = pregunta.trim().split(/\s+/).length;
    const profundo = ['explica','como funciona','por que','diferencia','analiza','resume'];
    return palabras <= 7 && !profundo.some(p => pregunta.toLowerCase().includes(p));
}

function tieneSenalesWeb(pregunta) {
    return SENALES_WEB.some(r => r.test(pregunta));
}

module.exports = {
    esPreguntaSimple,
    tieneSenalesWeb
};

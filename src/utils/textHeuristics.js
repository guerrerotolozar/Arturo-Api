/**
 * textHeuristics.js
 * 
 * Heurísticas de texto ULTRA-CONSERVADORAS.
 * 
 * FILOSOFÍA V8.5: La IA decide, no nosotros. Estas heurísticas solo
 * atajan los casos TRIVIALES (saludos de 1-2 palabras) para ahorrar
 * una llamada al orquestador (~90s). Todo lo demás pasa al modelo.
 * 
 * REGLA: Si hay ALGUNA duda de si es simple o no, NO es simple.
 */

/**
 * Detecta SOLO saludos y confirmaciones triviales de 1-3 palabras.
 * Si devuelve true, se salta el orquestador y va directo al chat.
 * 
 * CONSERVADORA A PROPÓSITO: es mejor llamar al orquestador de más
 * que perder una pregunta real. El modelo Fast puede manejar saludos
 * también, solo tarda un poco más.
 */
function esPreguntaSimple(pregunta) {
    const limpia = pregunta.trim().toLowerCase();
    const palabras = limpia.split(/\s+/).length;

    // Solo interceptar si tiene 3 palabras o menos
    if (palabras > 3) return false;

    // Saludos y despedidas
    if (/^(hola|buenas|hey|quiubo|hi|ey|epa|yo)[!?.,\s]*$/i.test(limpia)) return true;

    // Confirmaciones
    if (/^(gracias|listo|ok|perfecto|dale|vale|sí|si|no|chao|bye)[!?.,\s]*$/i.test(limpia)) return true;

    return false;
}

module.exports = {
    esPreguntaSimple
};

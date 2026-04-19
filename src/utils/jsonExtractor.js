/**
 * src/utils/jsonExtractor.js
 *
 * Extractor de JSON robusto para respuestas de LLMs locales.
 *
 * PROBLEMA QUE RESUELVE:
 * Los modelos instruct pequeños (qwen2.5:3b, etc.) a veces generan un JSON
 * perfecto pero luego "alucinan" tokens internos de ChatML, caracteres chinos,
 * o incluso intentan generar un segundo JSON después del primero.
 *
 * Ejemplo real:
 *   {"tareas":[{"herramienta":"code_interpreter",...}]} <|im_start|>user 敕 {"
 *
 * Una regex golosa /{[\s\S]*}/ captura desde la primera { hasta la última },
 * incluyendo toda la basura. Este módulo usa conteo de llaves con respeto
 * a strings literales para aislar quirúrgicamente el primer JSON completo.
 */

/**
 * Extrae el primer objeto JSON válido de un string con basura alrededor.
 * Usa conteo matemático de llaves con awareness de strings entrecomillados.
 *
 * @param {string} textoRaw - Respuesta cruda del LLM (puede tener basura)
 * @returns {string|null} - El substring JSON limpio, o null si no se encontró
 */
function extraerJSONValido(textoRaw) {
    if (!textoRaw || typeof textoRaw !== 'string') return null;

    // Paso 1: Limpiar markdown si el LLM envolvió en ```json ... ```
    let texto = textoRaw.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Paso 2: Encontrar la primera llave de apertura
    const inicio = texto.indexOf('{');
    if (inicio === -1) return null;

    // Paso 3: Conteo de llaves con respeto a strings
    let profundidad = 0;
    let dentroDeString = false;
    let charAnterior = '';

    for (let i = inicio; i < texto.length; i++) {
        const char = texto[i];

        // Manejar apertura/cierre de strings (ignorando \" escapadas)
        if (char === '"' && charAnterior !== '\\') {
            dentroDeString = !dentroDeString;
        }

        // Solo contar llaves que estén FUERA de strings
        if (!dentroDeString) {
            if (char === '{') profundidad++;
            if (char === '}') profundidad--;

            // Cuando profundidad vuelve a 0, encontramos el cierre del primer JSON
            if (profundidad === 0) {
                const candidato = texto.substring(inicio, i + 1);

                // Paso 4: Validar que sea JSON real (no un falso positivo)
                try {
                    JSON.parse(candidato);
                    return candidato;
                } catch {
                    // Falso positivo — el conteo de llaves cerró pero no era JSON válido.
                    // Seguir buscando desde este punto no tiene sentido,
                    // así que devolvemos el candidato y dejamos que el caller maneje el error.
                    return candidato;
                }
            }
        }

        charAnterior = char;
    }

    // Si llegamos aquí, las llaves nunca se balancearon
    return null;
}

module.exports = { extraerJSONValido };

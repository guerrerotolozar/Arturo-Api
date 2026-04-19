/**
 * src/core/vectorMath.js — Algebra lineal pura.
 *
 * Funciones sin side-effects: misma entrada → misma salida, siempre.
 * No importa nada del proyecto. Testeable de forma aislada.
 */

/**
 * Similitud del coseno entre dos vectores de igual dimensión.
 * 1.0 = idénticos, 0.0 = ortogonales.
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
function similitudCoseno(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot   += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { similitudCoseno };
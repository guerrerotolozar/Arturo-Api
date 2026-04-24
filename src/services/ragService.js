/**
 * src/services/ragService.js
 *
 * Lógica de Retrieval-Augmented Generation.
 * Depende de: vaultRepository (leer notas) + ollamaAdapter (embeddings) + vectorMath (coseno).
 * No toca req/res ni el file system directamente.
 */

const path = require('path');
const { leerVaultRecursivo }    = require('../repositories/vaultRepository');
const { buscarSemanticamente, estaDisponible } = require('../repositories/vectorRepository');
const { VAULT_PATH }            = require('../config/env');

const UMBRAL_FUSION = parseFloat(process.env.VAULT_UMBRAL_FUSION || '0.35'); // Ajustado para distancia de embeddings qwen3

/**
 * Búsqueda de contexto — Usa LanceDB (Rápido y Semántico)
 *
 * @param {string} pregunta
 * @param {number} maxFragmentos
 * @returns {Promise<Array<{fuente, texto, score}>>}
 */
async function buscarContexto(pregunta, maxFragmentos = 5) {
    const disponible = await estaDisponible();
    if (!disponible) {
        console.warn(`[RAG LANCEDB] LanceDB no disponible. Devuelve array vacío.`);
        return [];
    }

    console.log(`[RAG LANCEDB] Buscando semánticamente: "${pregunta}"`);
    const resultados = await buscarSemanticamente(pregunta, maxFragmentos);

    // Mapear al formato antiguo esperado por el agente
    return resultados.map(r => {
        const score = 1 - r.distancia; // Convertir distancia a similitud
        return {
            fuente: `${r.metadata.fuente} (${r.metadata.ruta})`,
            texto: r.texto,
            score: score
        };
    });
}

/**
 * Búsqueda para candidatos de FUSIÓN — umbral de embeddings.
 * Devuelve ruta absoluta para que el use-case pueda escribir.
 *
 * @param {string} texto
 * @param {number} maxCandidatos
 * @returns {Promise<Array<{nombre, ruta, rutaAbsoluta, fragmento, notaCompleta, score}>>}
 */
async function buscarCandidatosFusion(texto, maxCandidatos = 3) {
    const disponible = await estaDisponible();
    if (!disponible) return [];

    console.log(`[RAG FUSION LANCEDB] Buscando candidatos...`);
    const resultados = await buscarSemanticamente(texto.substring(0, 600), maxCandidatos);
    const candidatos = [];

    // Necesitamos la nota completa, así que leemos del filesystem usando la ruta que nos da LanceDB
    const notasFs = leerVaultRecursivo(); // Esto es rápido en memoria

    for (const r of resultados) {
        const score = 1 - r.distancia;
        if (score >= UMBRAL_FUSION) {
            const notaOriginal = notasFs.find(n => n.ruta === r.metadata.ruta);
            if (notaOriginal) {
                candidatos.push({
                    nombre:       r.metadata.fuente,
                    ruta:         r.metadata.ruta,
                    rutaAbsoluta: path.join(VAULT_PATH, r.metadata.ruta),
                    fragmento:    r.texto.substring(0, 500),
                    notaCompleta: notaOriginal.contenido.substring(0, 800), // Para dar contexto a la IA de fusión
                    score:        score
                });
            }
        }
    }

    console.log(candidatos.length > 0
        ? `[RAG FUSION] ${candidatos.length} candidato(s): ${candidatos.map(c => `${c.nombre} (${c.score.toFixed(3)})`).join(', ')}`
        : `[RAG FUSION] Sin candidatos fuertes → CREAR nota nueva.`
    );
    return candidatos;
}

module.exports = { buscarContexto, buscarCandidatosFusion, UMBRAL_FUSION };
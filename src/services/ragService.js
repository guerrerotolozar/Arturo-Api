/**
 * src/services/ragService.js
 *
 * Lógica de Retrieval-Augmented Generation.
 * Depende de: vaultRepository (leer notas) + ollamaAdapter (embeddings) + vectorMath (coseno).
 * No toca req/res ni el file system directamente.
 */

const path = require('path');
const { generarEmbedding }     = require('../adapters/ollamaAdapter');
const { leerVaultRecursivo }    = require('../repositories/vaultRepository');
const { similitudCoseno }       = require('../core/vectorMath');
const { VAULT_PATH }            = require('../config/env');

const UMBRAL_FUSION = parseFloat(process.env.VAULT_UMBRAL_FUSION || '0.78');

// Caché en RAM — no pide el mismo vector dos veces por sesión
const vectorCache = new Map();

async function obtenerVectorCacheado(texto) {
    if (vectorCache.has(texto)) return vectorCache.get(texto);
    const vector = await generarEmbedding(texto);
    vectorCache.set(texto, vector);
    return vector;
}

/**
 * Búsqueda de contexto súper rápida — Heurística de Texto.
 * Reemplaza los lentos vectores matemáticos (Ahorra >60s por búsqueda).
 *
 * @param {string} pregunta
 * @param {number} maxFragmentos
 * @returns {Promise<Array<{fuente, texto, score}>>}
 */
async function buscarContexto(pregunta, maxFragmentos = 5) {
    const notas = leerVaultRecursivo();
    if (notas.length === 0) {
        console.log(`[RAG TEXTO] Vault vacia — 0 notas cargadas.`);
        return [];
    }

    // Limpiar palabras vacías ('la', 'el', 'de')
    const palabrasQuery = pregunta.toLowerCase().replace(/[^\w\sáéíóú]/g, '').split(/\s+/).filter(p => p.length > 3);
    console.log(`[RAG TEXTO] ${notas.length} notas cargadas. Buscando palabras: [${palabrasQuery.join(', ')}]`);
    const fragmentos = [];

    for (const nota of notas) {
        for (const seccion of nota.contenido.split('\n\n')) {
            const limpio = seccion.trim();
            if (limpio.length < 40) continue;
            
            const seccionLower = limpio.toLowerCase();
            let score = 0;

            // Puntuación rudimentaria BM25
            for (const palabra of palabrasQuery) {
                if (seccionLower.includes(palabra)) {
                    score += 1;
                    // Boost si la palabra aparece varias veces
                    const matches = seccionLower.match(new RegExp(palabra, 'g')) || [];
                    score += (matches.length * 0.2);
                }
            }
            
            // Boost adicional si la nota completa se titula como algo de la busqueda
            if (palabrasQuery.some(p => nota.nombre.toLowerCase().includes(p))) {
                score += 2;
            }

            if (score >= 1) { // Umbral de al menos 1 coincidencia
                fragmentos.push({ fuente: `${nota.nombre} (${nota.ruta})`, texto: limpio.substring(0, 800), score });
            }
        }
    }

    return fragmentos.sort((a, b) => b.score - a.score).slice(0, maxFragmentos);
}

/**
 * Búsqueda para candidatos de FUSIÓN — umbral alto (0.78).
 * Devuelve ruta absoluta para que el use-case pueda escribir.
 *
 * @param {string} texto
 * @param {number} maxCandidatos
 * @returns {Promise<Array<{nombre, ruta, rutaAbsoluta, fragmento, notaCompleta, score}>>}
 */
async function buscarCandidatosFusion(texto, maxCandidatos = 3) {
    const notas = leerVaultRecursivo();
    if (notas.length === 0) return [];

    console.log(`[RAG FUSION] Buscando candidatos (umbral ${UMBRAL_FUSION})...`);
    const vectorTexto = await generarEmbedding(texto.substring(0, 600));
    const candidatos  = [];

    for (const nota of notas) {
        let maxScore = 0, mejorSeccion = '';
        for (const seccion of nota.contenido.split('\n\n')) {
            const limpio = seccion.trim();
            if (limpio.length < 40) continue;
            const score = similitudCoseno(vectorTexto, await obtenerVectorCacheado(limpio));
            if (score > maxScore) { maxScore = score; mejorSeccion = limpio; }
        }
        if (maxScore >= UMBRAL_FUSION) {
            candidatos.push({
                nombre:       nota.nombre,
                ruta:         nota.ruta,
                rutaAbsoluta: path.join(VAULT_PATH, nota.ruta),
                fragmento:    mejorSeccion.substring(0, 500),
                notaCompleta: nota.contenido.substring(0, 800),
                score:        maxScore
            });
        }
    }

    const resultado = candidatos.sort((a, b) => b.score - a.score).slice(0, maxCandidatos);
    console.log(resultado.length > 0
        ? `[RAG FUSION] ${resultado.length} candidato(s): ${resultado.map(c => `${c.nombre} (${c.score.toFixed(3)})`).join(', ')}`
        : `[RAG FUSION] Sin candidatos → CREAR nota nueva.`
    );
    return resultado;
}

module.exports = { buscarContexto, buscarCandidatosFusion, UMBRAL_FUSION };
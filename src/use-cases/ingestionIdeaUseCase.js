/**
 * src/use-cases/ingestionIdeaUseCase.js
 *
 * Clasifica una idea con IA y la persiste en el vault.
 * Diseñado para ejecución en background (fire-and-forget).
 */

const { clasificarIdea }                 = require('../services/llmService');
const { obtenerCategorias, escribirIdeaEnVault } = require('../services/vaultService');
const { obtenerTimestamp }               = require('../utils/dateUtils');

/**
 * @param {string} idea
 * @returns {Promise<{ categoria: string, ruta: string }>}
 */
async function ejecutarIngestionIdea(idea) {
    const categorias = obtenerCategorias();
    const categoria  = await clasificarIdea(idea, categorias);
    const timestamp  = obtenerTimestamp();

    escribirIdeaEnVault(categoria, idea, timestamp);
    console.log(`[INGESTION] Idea guardada en [[${categoria}]]`);

    return { categoria, ruta: `${categoria}.md` };
}

module.exports = { ejecutarIngestionIdea };
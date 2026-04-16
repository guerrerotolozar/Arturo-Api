/**
 * SearchService — Búsqueda web avanzada vía Tavily.
 * Los ojos de Arturo en internet.
 */

const { TAVILY_API_KEY, TAVILY_URL } = require('../config/env');

/**
 * Busca información en internet usando la API de Tavily.
 * Usa search_depth 'advanced' para resultados más precisos.
 * @param {string} query - Lo que se va a buscar
 * @returns {Promise<{answer: string|null, results: Array<{title: string, url: string, content: string}>}>}
 */
async function buscarEnWeb(query) {
    console.log(`[TAVILY] Buscando: "${query}"`);

    const response = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: query,
            search_depth: 'advanced',
            include_answer: true,
            max_results: 5
        })
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Sin detalle');
        throw new Error(`Tavily respondió con status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();

    const resultados = (data.results || []).map(r => ({
        title: r.title || 'Sin título',
        url: r.url || '',
        content: (r.content || '').substring(0, 600)
    }));

    console.log(`[TAVILY] ${resultados.length} resultados obtenidos`);

    return {
        answer: data.answer || null,
        results: resultados
    };
}

module.exports = {
    buscarEnWeb
};

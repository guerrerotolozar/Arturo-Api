/**
 * src/adapters/tavilyAdapter.js
 *
 * Única responsabilidad: hablar HTTP con la API de Tavily.
 */

const { TAVILY_API_KEY, TAVILY_URL } = require('../config/env');

/**
 * @param {string} query
 * @returns {Promise<{answer: string|null, results: Array<{title,url,content}>}>}
 */
async function buscarEnWeb(query) {
    if (!TAVILY_API_KEY) throw new Error('TAVILY_API_KEY no configurada en .env');

    console.log(`[TAVILY] Buscando: "${query}"`);

    const response = await fetch(TAVILY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            api_key:        TAVILY_API_KEY,
            query,
            search_depth:   'advanced',
            include_answer: true,
            max_results:    5
        })
    });

    if (!response.ok) {
        const detalle = await response.text().catch(() => '');
        throw new Error(`Tavily respondio ${response.status}: ${detalle}`);
    }

    const data = await response.json();
    return {
        answer:  data.answer || null,
        results: (data.results || []).map(r => ({
            title:   r.title   || 'Sin titulo',
            url:     r.url     || '',
            content: (r.content || '').substring(0, 600)
        }))
    };
}

module.exports = { buscarEnWeb };
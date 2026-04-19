/**
 * src/tools/tavilySearchTool.js
 */

const { buscarEnWeb } = require('../adapters/tavilyAdapter');

module.exports = {
    nombre:      'tavily_search',
    descripcion: 'Para buscar datos actuales en internet (precios, noticias, compatibilidades, disponibilidad). Requiere el campo "query" con una consulta concreta de 5-15 palabras.',

    /**
     * @param {{ query: string }} params
     * @returns {{ resumen: string, resultados: Array }}
     */
    async ejecutar({ query }) {
        if (!query) throw new Error('tavilySearchTool: falta el campo "query"');

        console.log(`[TOOL tavily_search] Buscando: "${query}"`);
        const web = await buscarEnWeb(query);

        const resumen = web.answer
            ? web.answer
            : web.results.slice(0, 3).map(r => `[${r.title}] ${r.content}`).join('\n\n');

        return {
            resumen:    `Datos de internet sobre "${query}":\n${resumen}`,
            resultados: web.results
        };
    }
};
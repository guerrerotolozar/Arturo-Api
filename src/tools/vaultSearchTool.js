/**
 * src/tools/vaultSearchTool.js
 */

const { buscarContexto } = require('../services/ragService');

module.exports = {
    nombre:      'vault_search',
    descripcion: 'Para buscar en el Segundo Cerebro local de Ronald (notas de Obsidian). Requiere el campo "query" con el tema a buscar.',

    /**
     * @param {{ query: string }} params
     * @returns {{ resumen: string, fragmentos: Array }}
     */
    async ejecutar({ query }) {
        if (!query) throw new Error('vaultSearchTool: falta el campo "query"');

        console.log(`[TOOL vault_search] Buscando en vault: "${query}"`);
        const fragmentos = await buscarContexto(query);

        const resumen = fragmentos.length > 0
            ? 'Datos encontrados en las notas locales:\n' +
              fragmentos.map(f => `- [${f.fuente}]: ${f.texto}`).join('\n')
            : 'No encontre nada escrito sobre esto en el Segundo Cerebro.';

        return { resumen, fragmentos };
    }
};
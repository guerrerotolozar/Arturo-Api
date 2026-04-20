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
        console.log(`[TOOL vault_search] Fragmentos encontrados: ${fragmentos.length}`);

        if (fragmentos.length > 0) {
            const resumen = 'Informacion encontrada en el Segundo Cerebro de Ronald:\n' +
                fragmentos.map(f => `- Nota [${f.fuente}]: ${f.texto}`).join('\n');
            return { resumen, fragmentos };
        }
        
        return { 
            resumen: `No se encontro informacion sobre "${query}" en las notas del Segundo Cerebro. El Cerebro SI es accesible, simplemente no hay notas escritas sobre ese tema especifico.`, 
            fragmentos: [] 
        };
    }
};
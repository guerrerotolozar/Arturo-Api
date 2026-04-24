/**
 * src/tools/vaultSearchSemanticTool.js
 *
 * Herramienta de búsqueda SEMÁNTICA en la Bóveda de Ronald.
 * Usa ChromaDB + embeddings (qwen3-embedding) para encontrar
 * fragmentos por significado, no solo por coincidencia de texto.
 *
 * Se registra automáticamente vía el auto-scan de tools/index.js.
 * Convive con vaultSearchTool.js (búsqueda por texto) — el agente
 * puede usar cualquiera según la situación.
 */

const { buscarSemanticamente, estaDisponible } = require('../repositories/vectorRepository');

module.exports = {
    nombre:      'vault_search_semantic',
    descripcion: 'Búsqueda inteligente en el Segundo Cerebro de Ronald usando IA semántica. Encuentra fragmentos por SIGNIFICADO, no solo por palabras exactas. Ideal para preguntas conceptuales como "¿qué opino sobre productividad?" o "dame contexto sobre mis proyectos". Requiere el campo "query" con el tema a buscar.',

    /**
     * @param {{ query: string, topK?: number }} params
     * @returns {{ resumen: string, fragmentos: Array }}
     */
    async ejecutar({ query, topK = 5 }) {
        if (!query) throw new Error('vault_search_semantic: falta el campo "query"');

        console.log(`[TOOL vault_search_semantic] Búsqueda semántica: "${query}"`);

        // Verificar que ChromaDB esté disponible
        const disponible = await estaDisponible();
        if (!disponible) {
            console.log(`[TOOL vault_search_semantic] ChromaDB no disponible — fallback info.`);
            return {
                resumen: 'La base de datos vectorial (ChromaDB) no está disponible en este momento. Usa "vault_search" como alternativa para búsqueda por texto.',
                fragmentos: []
            };
        }

        const resultados = await buscarSemanticamente(query, topK);
        console.log(`[TOOL vault_search_semantic] ${resultados.length} fragmentos encontrados.`);

        if (resultados.length > 0) {
            const resumen = 'Información encontrada en el Segundo Cerebro de Ronald (búsqueda semántica):\n' +
                resultados.map(r => {
                    const fuente = r.metadata?.fuente || 'Desconocido';
                    const ruta   = r.metadata?.ruta || '';
                    const score  = (1 - r.distancia).toFixed(3); // Convertir distancia a similitud
                    return `- [${fuente}] (${ruta}) [similitud: ${score}]: ${r.texto.substring(0, 600)}`;
                }).join('\n');

            return { resumen, fragmentos: resultados };
        }

        return {
            resumen: `No se encontró información semánticamente relacionada con "${query}" en el Cerebro. Esto puede significar que la Bóveda no ha sido sincronizada aún, o que no hay notas sobre ese tema.`,
            fragmentos: []
        };
    }
};

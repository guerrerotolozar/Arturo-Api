/**
 * src/repositories/vectorRepository.js
 *
 * Única responsabilidad: leer y escribir en la base de datos vectorial (ChromaDB).
 * No sabe de LLMs, prompts ni lógica de negocio.
 *
 * ChromaDB se usa como librería npm (sin Docker).
 * La colección "arturo_boveda" almacena chunks de archivos .md
 * con sus embeddings generados por Ollama (qwen3-embedding).
 */

const { ChromaClient } = require('chromadb');
const { generarEmbedding } = require('../adapters/ollamaAdapter');

const COLLECTION_NAME = 'arturo_boveda';

// Cliente ChromaDB — se conecta al servidor local (por defecto http://localhost:8000)
// Si ChromaDB corre como server, usa el default.
// Si corre in-process vía npm, usa { path: './chroma_data' }
let client = null;
let collection = null;

/**
 * Inicializa la conexión a ChromaDB y obtiene (o crea) la colección principal.
 * Se llama una sola vez al arranque. Las llamadas siguientes reutilizan la conexión.
 */
async function inicializar() {
    if (collection) return collection;

    try {
        client = new ChromaClient({ path: 'http://localhost:8000' });
        collection = await client.getOrCreateCollection({
            name: COLLECTION_NAME,
            metadata: { 'hnsw:space': 'cosine' } // Distancia coseno para similitud semántica
        });
        const count = await collection.count();
        console.log(`[VECTOR-DB] Colección "${COLLECTION_NAME}" lista — ${count} documentos.`);
        return collection;
    } catch (err) {
        console.error(`[VECTOR-DB] ⚠️  No se pudo conectar a ChromaDB: ${err.message}`);
        console.error(`[VECTOR-DB] Asegúrate de que ChromaDB esté corriendo en http://localhost:8000`);
        collection = null;
        throw err;
    }
}

/**
 * Verifica si ChromaDB está disponible.
 * @returns {Promise<boolean>}
 */
async function estaDisponible() {
    try {
        await inicializar();
        return true;
    } catch {
        return false;
    }
}

/**
 * Inserta o actualiza documentos en la colección.
 * Usa upsert para evitar duplicados (si el ID ya existe, lo reemplaza).
 *
 * @param {Array<{id: string, texto: string, metadata: object}>} chunks
 */
async function upsertDocumentos(chunks) {
    const col = await inicializar();

    // ChromaDB acepta batches, pero para embeddings locales (Ollama)
    // generamos uno por uno para no saturar la VRAM.
    const BATCH_SIZE = 20;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);

        // Generar embeddings para el batch
        const embeddings = [];
        for (const chunk of batch) {
            try {
                const vector = await generarEmbedding(chunk.texto);
                embeddings.push(vector);
            } catch (err) {
                console.error(`[VECTOR-DB] Error generando embedding para "${chunk.id}": ${err.message}`);
                // Usar vector vacío como fallback (se filtrará en búsqueda)
                embeddings.push([]);
            }
        }

        // Filtrar chunks que fallaron (embedding vacío)
        const validIds = [];
        const validDocs = [];
        const validEmbeddings = [];
        const validMetadatas = [];

        for (let j = 0; j < batch.length; j++) {
            if (embeddings[j].length > 0) {
                validIds.push(batch[j].id);
                validDocs.push(batch[j].texto);
                validEmbeddings.push(embeddings[j]);
                validMetadatas.push(batch[j].metadata || {});
            }
        }

        if (validIds.length > 0) {
            await col.upsert({
                ids: validIds,
                documents: validDocs,
                embeddings: validEmbeddings,
                metadatas: validMetadatas
            });
        }

        // Progreso
        const procesados = Math.min(i + BATCH_SIZE, chunks.length);
        console.log(`[VECTOR-DB] Progreso: ${procesados}/${chunks.length} chunks procesados.`);
    }
}

/**
 * Búsqueda semántica en la colección.
 *
 * @param {string} query - Texto de búsqueda
 * @param {number} topK  - Número máximo de resultados
 * @returns {Promise<Array<{id: string, texto: string, metadata: object, distancia: number}>>}
 */
async function buscarSemanticamente(query, topK = 5) {
    const col = await inicializar();

    // Generar embedding de la consulta
    const queryEmbedding = await generarEmbedding(query);

    const resultados = await col.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK
    });

    // Aplanar la estructura de ChromaDB
    if (!resultados.ids || resultados.ids.length === 0 || resultados.ids[0].length === 0) {
        return [];
    }

    return resultados.ids[0].map((id, i) => ({
        id,
        texto: resultados.documents[0][i],
        metadata: resultados.metadatas[0][i] || {},
        distancia: resultados.distances[0][i]
    }));
}

/**
 * Elimina todos los documentos de la colección (reset completo).
 */
async function limpiarColeccion() {
    try {
        const cl = client || new ChromaClient({ path: 'http://localhost:8000' });
        await cl.deleteCollection({ name: COLLECTION_NAME });
        collection = null;
        console.log(`[VECTOR-DB] Colección "${COLLECTION_NAME}" eliminada.`);
    } catch (err) {
        console.error(`[VECTOR-DB] Error limpiando colección: ${err.message}`);
    }
}

/**
 * Obtiene la cantidad de documentos almacenados.
 * @returns {Promise<number>}
 */
async function contarDocumentos() {
    try {
        const col = await inicializar();
        return await col.count();
    } catch {
        return 0;
    }
}

module.exports = {
    inicializar,
    estaDisponible,
    upsertDocumentos,
    buscarSemanticamente,
    limpiarColeccion,
    contarDocumentos
};

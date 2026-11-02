/**
 * src/repositories/vectorRepository.js
 *
 * Única responsabilidad: leer y escribir en la base de datos vectorial (LanceDB).
 * No sabe de LLMs, prompts ni lógica de negocio.
 *
 * LanceDB es EMBEBIDA (como SQLite): vive dentro del proceso de Node,
 * cero servidores externos, cero Python, cero Docker.
 * Los datos se guardan en la carpeta ./lancedb_data junto al API.
 */

const path = require('path');
const { generarEmbedding, generarEmbeddingsBatch } = require('../adapters/ollamaAdapter');

const TABLE_NAME = 'arturo_boveda';
const DB_PATH = path.join(__dirname, '../../lancedb_data');

// Conexión y tabla — se inicializan lazy
let db = null;
let table = null;
let autoSyncPromise = null;

/**
 * Inicializa la conexión a LanceDB y obtiene (o crea) la tabla principal.
 * Se llama una sola vez al arranque. Las llamadas siguientes reutilizan la conexión.
 */
async function inicializar() {
    if (table) return table;

    try {
        // Import dinámico porque @lancedb/lancedb es ESM
        const lancedb = await import('@lancedb/lancedb');
        db = await lancedb.connect(DB_PATH);

        // Verificar si la tabla ya existe
        const tablas = await db.tableNames();

        if (tablas.includes(TABLE_NAME)) {
            table = await db.openTable(TABLE_NAME);
            const count = await table.countRows();
            console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" abierta — ${count} documentos.`);
        } else {
            // No existe aún — se creará cuando se inserten datos por primera vez
            table = null;
            console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" no existe aún. Se creará al sincronizar.`);
        }

        return table;
    } catch (err) {
        console.error(`[VECTOR-DB] ⚠️  Error inicializando LanceDB: ${err.message}`);
        table = null;
        throw err;
    }
}

/**
 * Verifica si LanceDB está disponible.
 * @returns {Promise<boolean>}
 */
async function estaDisponible() {
    try {
        if (db) return true;
        await inicializar();
        return db !== null;
    } catch {
        return false;
    }
}

/**
 * Inserta o actualiza documentos en la tabla.
 * Si la tabla no existe, la crea con el primer batch.
 *
 * @param {Array<{id: string, texto: string, metadata: object}>} chunks
 */
async function upsertDocumentos(chunks) {
    const lancedb = await import('@lancedb/lancedb');

    if (!db) {
        db = await lancedb.connect(DB_PATH);
    }

    // Generar embeddings en batch y construir registros para LanceDB
    const registros = [];
    const BATCH_SIZE = 20;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const textosBatch = batch.map(c => c.texto);

        try {
            const vectores = await generarEmbeddingsBatch(textosBatch);
            for (let j = 0; j < batch.length; j++) {
                const chunk = batch[j];
                const vector = vectores[j];
                if (vector && vector.length > 0) {
                    registros.push({
                        id: chunk.id,
                        text: chunk.texto.substring(0, 2000), // Limitar para eficiencia
                        vector: vector,
                        tags: chunk.metadata?.tags || '',
                        fuente: chunk.metadata?.fuente || '',
                        ruta: chunk.metadata?.ruta || '',
                        carpeta: chunk.metadata?.carpeta || '',
                        sincronizado: chunk.metadata?.sincronizado || new Date().toISOString()
                    });
                }
            }
        } catch (err) {
            console.error(`[VECTOR-DB] Error generando batch de embeddings (${i}-${i + batch.length}): ${err.message}`);
        }

        // Progreso
        const procesados = Math.min(i + BATCH_SIZE, chunks.length);
        console.log(`[VECTOR-DB] Progreso: ${procesados}/${chunks.length} chunks procesados.`);
    }

    if (registros.length === 0) {
        console.warn('[VECTOR-DB] No se generaron registros válidos.');
        return;
    }

    // Verificar si la tabla existe y si su dimensión coincide con el vector actual (ej. 1024 -> 4096 con qwen3-embedding:8b)
    const tablas = await db.tableNames();
    const expectedDim = registros[0].vector.length;

    if (tablas.includes(TABLE_NAME)) {
        table = await db.openTable(TABLE_NAME);
        let incompatible = false;
        try {
            const sample = await table.query().limit(1).toArray();
            if (sample && sample.length > 0 && sample[0].vector && sample[0].vector.length !== expectedDim) {
                incompatible = true;
                console.log(`[VECTOR-DB] Cambio de dimensión detectado (${sample[0].vector.length} -> ${expectedDim}). Recreando "${TABLE_NAME}"...`);
            }
        } catch {
            incompatible = true;
        }

        if (incompatible) {
            await db.dropTable(TABLE_NAME);
            table = await db.createTable(TABLE_NAME, registros);
            console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" recreada con dimensión ${expectedDim} (${registros.length} registros).`);
        } else {
            await table.add(registros);
            console.log(`[VECTOR-DB] ${registros.length} registros agregados a tabla existente.`);
        }
    } else {
        // Tabla no existe → crearla con los datos
        table = await db.createTable(TABLE_NAME, registros);
        console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" creada con ${registros.length} registros.`);
    }
}

/**
 * Dispara una sincronización completa de rescate cuando la tabla no existe o cambió de dimensión.
 */
async function _autoReconstruirIndice(razon) {
    if (!autoSyncPromise) {
        console.log(`[VECTOR-DB] 🔄 Auto-reconstruyendo índice vectorial (${razon})...`);
        const { sincronizarBoveda } = require('../use-cases/vaultIndexer');
        autoSyncPromise = sincronizarBoveda({ forzarReset: true })
            .catch(err => console.error(`[VECTOR-DB] Error en auto-reconstrucción: ${err.message}`))
            .finally(() => { autoSyncPromise = null; });
    }
    await autoSyncPromise;
    table = null;
    await inicializar();
}

/**
 * Búsqueda semántica en la tabla (Distancia Coseno, auto-reparable).
 *
 * @param {string} query - Texto de búsqueda
 * @param {number} topK  - Número máximo de resultados
 * @param {Array<string>} tagsFiltro - Tags opcionales para filtrar (ej: ['#finanzas'])
 * @param {object} opciones - Filtros estructurales pre-búsqueda ({ excluirMedia, soloProyectos })
 * @returns {Promise<Array<{id: string, texto: string, metadata: object, distancia: number}>>}
 */
async function buscarSemanticamente(query, topK = 5, tagsFiltro = [], opciones = {}) {
    if (!(await estaDisponible())) {
        await inicializar();
    }

    if (!table) {
        await _autoReconstruirIndice('tabla inexistente');
    }

    if (!table) {
        console.warn('[VECTOR-DB] No hay tabla para buscar tras intento de sincronización.');
        return [];
    }

    // Generar embedding de la consulta (4096d con qwen3-embedding:8b)
    const queryEmbedding = await generarEmbedding(query);

    // Verificar compatibilidad de dimensión antes de ejecutar query
    try {
        const sample = await table.query().limit(1).toArray();
        if (sample && sample.length > 0 && sample[0].vector && sample[0].vector.length !== queryEmbedding.length) {
            await _autoReconstruirIndice(`dimensión ${sample[0].vector.length} != ${queryEmbedding.length}`);
        }
    } catch {
        // Si falla la inspección previa, continuamos y capturamos en el vectorSearch
    }

    if (!table) return [];

    const clausulasWhere = [];
    if (tagsFiltro && tagsFiltro.length > 0) {
        const condTags = tagsFiltro.map(t => `tags LIKE '%${t}%'`).join(' OR ');
        clausulasWhere.push(`(${condTags})`);
    }
    if (opciones && opciones.excluirMedia) {
        clausulasWhere.push(`(carpeta != 'Media' AND ruta NOT LIKE 'Media/%' AND ruta NOT LIKE '%/Media/%')`);
    }
    if (opciones && opciones.soloProyectos) {
        clausulasWhere.push(`(ruta LIKE 'OPERACIONES/Proyectos/%' OR ruta LIKE 'OPERACIONES/Finanzas/%')`);
    }

    const whereFinal = clausulasWhere.length > 0 ? clausulasWhere.join(' AND ') : null;

    let resultados;
    try {
        let busqueda = table.vectorSearch(queryEmbedding).distanceType('cosine');

        if (whereFinal) {
            busqueda = busqueda.where(whereFinal);
            console.log(`[VECTOR-DB] Pre-filtro activado: ${whereFinal}`);
        }

        resultados = await busqueda
            .limit(topK)
            .toArray();
    } catch (err) {
        if (String(err.message || '').includes('dimension')) {
            await _autoReconstruirIndice(`error de dimensión en query: ${err.message}`);
            if (!table) return [];
            let reintento = table.vectorSearch(queryEmbedding).distanceType('cosine');
            if (whereFinal) reintento = reintento.where(whereFinal);
            resultados = await reintento.limit(topK).toArray();
        } else {
            throw err;
        }
    }

    // Mapear al formato estándar
    return resultados.map(r => ({
        id: r.id,
        texto: r.text,
        metadata: {
            fuente: r.fuente,
            ruta: r.ruta,
            carpeta: r.carpeta,
            tags: r.tags || '',
            sincronizado: r.sincronizado
        },
        distancia: r._distance !== undefined ? r._distance : 0
    }));
}

/**
 * Elimina todos los chunks (documentos) asociados a una ruta de archivo específica.
 * @param {string} ruta 
 */
async function eliminarDocumentosPorRuta(ruta) {
    if (!table) await inicializar();
    if (!table) return;

    try {
        // En LanceDB, la condición delete se escribe en sintaxis SQL-like
        // Usamos comillas dobles para escapar strings en caso de caracteres raros, 
        // aunque LanceDB suele requerir comillas simples para strings. Escapamos comillas simples.
        const rutaEscapada = ruta.replace(/'/g, "''");
        await table.delete(`ruta = '${rutaEscapada}'`);
        console.log(`[VECTOR-DB] 🗑️  Chunks eliminados para: ${ruta}`);
    } catch (err) {
        console.error(`[VECTOR-DB] Error eliminando chunks de ${ruta}: ${err.message}`);
    }
}

/**
 * Elimina la tabla completa (reset).
 */
async function limpiarColeccion() {
    try {
        const lancedb = await import('@lancedb/lancedb');
        if (!db) db = await lancedb.connect(DB_PATH);
        await db.dropTable(TABLE_NAME);
        table = null;
        console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" eliminada.`);
    } catch (err) {
        // Si la tabla no existe, no es un error
        if (err.message && err.message.includes('not found')) {
            console.log(`[VECTOR-DB] Tabla "${TABLE_NAME}" no existía.`);
        } else {
            console.error(`[VECTOR-DB] Error limpiando tabla: ${err.message}`);
        }
        table = null;
    }
}

/**
 * Obtiene la cantidad de documentos almacenados.
 * @returns {Promise<number>}
 */
async function contarDocumentos() {
    try {
        if (!table) await inicializar();
        if (!table) return 0;
        return await table.countRows();
    } catch {
        return 0;
    }
}

module.exports = {
    inicializar,
    estaDisponible,
    upsertDocumentos,
    buscarSemanticamente,
    eliminarDocumentosPorRuta,
    limpiarColeccion,
    contarDocumentos
};

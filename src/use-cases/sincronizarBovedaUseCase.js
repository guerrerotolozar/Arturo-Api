/**
 * src/use-cases/sincronizarBovedaUseCase.js
 *
 * Única responsabilidad: leer la Bóveda de Obsidian, dividir el contenido
 * en chunks lógicos y guardarlos en ChromaDB con sus embeddings.
 *
 * No toca req/res — recibe parámetros, devuelve resultado.
 *
 * Estrategia de chunking:
 *   1. Divide cada archivo .md por encabezados (## o ###)
 *   2. Si un bloque no tiene encabezados, divide por doble salto de línea
 *   3. Cada chunk lleva metadata: ruta, nombre, carpeta, fecha de sync
 */

const { leerVaultRecursivo } = require('../repositories/vaultRepository');
const { upsertDocumentos, limpiarColeccion, contarDocumentos, estaDisponible } = require('../repositories/vectorRepository');
const { VAULT_PATH_BOVEDA } = require('../config/env');

/**
 * Divide el contenido de un archivo .md en chunks lógicos.
 *
 * @param {string} contenido  - Texto completo del archivo
 * @param {string} nombreNota - Nombre del archivo (sin extensión)
 * @param {string} rutaNota   - Ruta relativa dentro del vault
 * @returns {Array<{id: string, texto: string, metadata: object}>}
 */
function dividirEnChunks(contenido, nombreNota, rutaNota) {
    const chunks = [];
    const MIN_CHUNK_LENGTH = 50;  // Ignorar chunks muy cortos (títulos solos, etc.)
    const MAX_CHUNK_LENGTH = 1500; // Limitar chunks muy largos para embeddings de calidad

    // Paso 1: Dividir por encabezados markdown (##, ###, ####)
    const secciones = contenido.split(/(?=^#{2,4}\s)/m);

    for (const seccion of secciones) {
        const limpio = seccion.trim();
        if (limpio.length < MIN_CHUNK_LENGTH) continue;

        // Si la sección es muy larga, subdividir por doble salto de línea
        if (limpio.length > MAX_CHUNK_LENGTH) {
            const parrafos = limpio.split(/\n\n+/);
            let buffer = '';

            for (const parrafo of parrafos) {
                if ((buffer + '\n\n' + parrafo).length > MAX_CHUNK_LENGTH && buffer.length >= MIN_CHUNK_LENGTH) {
                    chunks.push(crearChunk(buffer.trim(), nombreNota, rutaNota, chunks.length));
                    buffer = parrafo;
                } else {
                    buffer += (buffer ? '\n\n' : '') + parrafo;
                }
            }
            // Flush del buffer restante
            if (buffer.trim().length >= MIN_CHUNK_LENGTH) {
                chunks.push(crearChunk(buffer.trim(), nombreNota, rutaNota, chunks.length));
            }
        } else {
            chunks.push(crearChunk(limpio, nombreNota, rutaNota, chunks.length));
        }
    }

    return chunks;
}

/**
 * Crea un objeto chunk con su ID único y metadata.
 */
function crearChunk(texto, nombreNota, rutaNota, index) {
    // ID único: ruta_normalizada::índice_seccion
    const idBase = rutaNota.replace(/[/\\]/g, '_').replace(/\.md$/, '');
    return {
        id: `${idBase}::${index}`,
        texto,
        metadata: {
            fuente: nombreNota,
            ruta: rutaNota,
            carpeta: rutaNota.split(/[/\\]/)[0] || 'raiz',
            seccion: index,
            largo: texto.length,
            sincronizado: new Date().toISOString()
        }
    };
}

/**
 * Ejecuta la sincronización completa de la Bóveda a ChromaDB.
 *
 * @param {object} opciones
 * @param {boolean}  opciones.forzarReset - Si true, borra la colección antes de insertar
 * @param {string}   opciones.carpeta     - Si se especifica, solo sincroniza esa carpeta
 * @param {function} opciones.onProgress  - Callback de progreso
 * @returns {Promise<{exito: boolean, totalNotas: number, totalChunks: number, tiempo: number}>}
 */
async function sincronizarBoveda({ forzarReset = false, carpeta = null, onProgress = () => {} } = {}) {
    const tStart = Date.now();

    // 1. Verificar que ChromaDB esté disponible
    const disponible = await estaDisponible();
    if (!disponible) {
        return {
            exito: false,
            error: 'ChromaDB no está disponible. Asegúrate de que esté corriendo en localhost:8000.',
            totalNotas: 0,
            totalChunks: 0,
            tiempo: 0
        };
    }

    // 2. Reset si se solicita
    if (forzarReset) {
        onProgress('Limpiando colección anterior...');
        await limpiarColeccion();
        console.log('[SYNC] Colección limpiada — reset forzado.');
    }

    // 3. Leer todas las notas de la Bóveda
    onProgress('Leyendo Bóveda...');
    const dirLectura = carpeta
        ? require('path').join(VAULT_PATH_BOVEDA || '', carpeta)
        : undefined; // undefined = leer todo el vault (usa default de leerVaultRecursivo)

    const notas = leerVaultRecursivo(dirLectura);
    console.log(`[SYNC] ${notas.length} notas leídas de la Bóveda.`);

    if (notas.length === 0) {
        return { exito: true, totalNotas: 0, totalChunks: 0, tiempo: Date.now() - tStart };
    }

    // 4. Generar chunks de todas las notas
    onProgress(`Dividiendo ${notas.length} notas en chunks...`);
    const todosLosChunks = [];

    for (const nota of notas) {
        const chunks = dividirEnChunks(nota.contenido, nota.nombre, nota.ruta);
        todosLosChunks.push(...chunks);
    }
    console.log(`[SYNC] ${todosLosChunks.length} chunks generados.`);

    // 5. Insertar en ChromaDB (con embeddings via Ollama)
    onProgress(`Vectorizando ${todosLosChunks.length} chunks (esto puede tomar unos minutos)...`);
    await upsertDocumentos(todosLosChunks);

    const totalEnDB = await contarDocumentos();
    const tiempoTotal = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[SYNC] ✅ Sincronización completada: ${totalEnDB} docs en ChromaDB [${tiempoTotal}s]`);

    return {
        exito: true,
        totalNotas: notas.length,
        totalChunks: todosLosChunks.length,
        totalEnDB,
        tiempo: parseFloat(tiempoTotal)
    };
}

/**
 * Obtiene el estado actual de la base vectorial.
 * @returns {Promise<{disponible: boolean, documentos: number}>}
 */
async function obtenerEstadoVectorial() {
    const disponible = await estaDisponible();
    const documentos = disponible ? await contarDocumentos() : 0;
    return { disponible, documentos };
}

module.exports = { sincronizarBoveda, obtenerEstadoVectorial };

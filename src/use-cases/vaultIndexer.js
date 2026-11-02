/**
 * src/use-cases/sincronizarBovedaUseCase.js
 *
 * Única responsabilidad: leer la Bóveda de Obsidian, dividir el contenido
 * en chunks lógicos y guardarlos en LanceDB con sus embeddings.
 *
 * No toca req/res — recibe parámetros, devuelve resultado.
 *
 * Estrategia de chunking:
 *   1. Divide cada archivo .md por encabezados (## o ###)
 *   2. Si un bloque no tiene encabezados, divide por doble salto de línea
 *   3. Cada chunk lleva metadata: ruta, nombre, carpeta, fecha de sync
 */

const { leerVaultRecursivo } = require('../repositories/vaultRepository');
const { upsertDocumentos, limpiarColeccion, contarDocumentos, estaDisponible, eliminarDocumentosPorRuta } = require('../repositories/vectorRepository');
const { obtenerEstadoSync, upsertEstadoSync, eliminarEstadoSync, limpiarEstadoSync } = require('../repositories/syncRepository');
const { VAULT_PATH_BOVEDA } = require('../config/env');

/**
 * Extrae los tags del frontmatter YAML de una nota.
 * @param {string} contenido
 * @returns {string} Tags separados por comas (ej: "#cliente/dolly, #finanzas")
 */
function extraerTagsYAML(contenido) {
    const tags = new Set();
    const match = contenido.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match) {
        const frontmatter = match[1];
        
        // Formato lista
        const tagsRegex = /tags:\s*\r?\n((?:\s+- .*\r?\n?)*)/;
        const tagsMatch = frontmatter.match(tagsRegex);
        if (tagsMatch && tagsMatch[1]) {
            const items = tagsMatch[1].match(/^\s+- (.*)$/gm);
            if (items) {
                items.forEach(item => {
                    let tag = item.replace(/^\s+- /, '').trim();
                    if (tag.startsWith('"') || tag.startsWith("'")) tag = tag.slice(1, -1);
                    if (tag) tags.add('#' + tag.replace(/^#/, ''));
                });
            }
        }
        
        // Formato inline
        const inlineTagsRegex = /^tags:\s*\[?(.*?)\]?$/m;
        const inlineMatch = frontmatter.match(inlineTagsRegex);
        if (inlineMatch && inlineMatch[1] && !inlineMatch[0].includes('\n')) {
            const list = inlineMatch[1].split(',');
            list.forEach(t => {
                let tag = t.trim();
                if (tag.startsWith('"') || tag.startsWith("'")) tag = tag.slice(1, -1);
                if (tag) tags.add('#' + tag.replace(/^#/, ''));
            });
        }
    }
    return Array.from(tags).join(', ');
}

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

    const tagsMetadata = extraerTagsYAML(contenido);

    // Excluir zonas de máquina (auto:begin/end) para evitar bucles e indexado de metadatos operativos
    const contenidoLimpio = String(contenido || '').replace(/<!-- auto:begin -->[\s\S]*?<!-- auto:end -->/g, '');

    // Paso 1: Dividir por encabezados markdown (##, ###, ####)
    const secciones = contenidoLimpio.split(/(?=^#{2,4}\s)/m);

    for (const seccion of secciones) {
        const limpio = seccion.trim();
        if (limpio.length < MIN_CHUNK_LENGTH) continue;

        // Si la sección es muy larga, subdividir por doble salto de línea
        if (limpio.length > MAX_CHUNK_LENGTH) {
            const parrafos = limpio.split(/\n\n+/);
            let buffer = '';

            for (const parrafo of parrafos) {
                if ((buffer + '\n\n' + parrafo).length > MAX_CHUNK_LENGTH && buffer.length >= MIN_CHUNK_LENGTH) {
                    chunks.push(crearChunk(buffer.trim(), nombreNota, rutaNota, chunks.length, tagsMetadata));
                    buffer = parrafo;
                } else {
                    buffer += (buffer ? '\n\n' : '') + parrafo;
                }
            }
            // Flush del buffer restante
            if (buffer.trim().length >= MIN_CHUNK_LENGTH) {
                chunks.push(crearChunk(buffer.trim(), nombreNota, rutaNota, chunks.length, tagsMetadata));
            }
        } else {
            chunks.push(crearChunk(limpio, nombreNota, rutaNota, chunks.length, tagsMetadata));
        }
    }

    return chunks;
}

/**
 * Crea un objeto chunk con su ID único y metadata.
 */
function crearChunk(texto, nombreNota, rutaNota, index, tags = '') {
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
            tags: tags,
            sincronizado: new Date().toISOString()
        }
    };
}

/**
 * Ejecuta la sincronización completa de la Bóveda a LanceDB.
 *
 * @param {object} opciones
 * @param {boolean}  opciones.forzarReset - Si true, borra la colección antes de insertar
 * @param {string}   opciones.carpeta     - Si se especifica, solo sincroniza esa carpeta
 * @param {function} opciones.onProgress  - Callback de progreso
 * @returns {Promise<{exito: boolean, totalNotas: number, totalChunks: number, tiempo: number}>}
 */
async function sincronizarBoveda({ forzarReset = false, carpeta = null, onProgress = () => {} } = {}) {
    const tStart = Date.now();

    // 1. Verificar que LanceDB esté disponible
    const disponible = await estaDisponible();
    if (!disponible) {
        return {
            exito: false,
            error: 'LanceDB no está disponible. Verifica que @lancedb/lancedb esté instalado.',
            totalNotas: 0,
            totalChunks: 0,
            tiempo: 0
        };
    }

    // 2. Reset si se solicita
    if (forzarReset) {
        onProgress('Limpiando colección anterior...');
        await limpiarColeccion();
        limpiarEstadoSync(); // Limpiar también SQLite
        console.log('[SYNC] Colección y estado limpiados — reset forzado.');
    }

    // 3. Leer todas las notas de la Bóveda (y sus mtimeMs)
    onProgress('Analizando Bóveda...');
    const dirLectura = carpeta
        ? require('path').join(VAULT_PATH_BOVEDA || '', carpeta)
        : undefined; // undefined = leer todo el vault

    const notasFisicas = leerVaultRecursivo(dirLectura);
    console.log(`[SYNC] ${notasFisicas.length} notas detectadas en disco.`);

    // 4. Lógica Incremental: Comparar con SQLite
    const estadoAnterior = obtenerEstadoSync(); // Map<ruta, mtimeMs>
    const notasAProcesar = [];
    const rutasEnBoveda = new Set();
    
    let eliminadas = 0;
    
    for (const nota of notasFisicas) {
        rutasEnBoveda.add(nota.ruta);
        // Math.floor para evitar ligeros bugs de precisión de microsegundos en fs.stat
        const mtimeMsNota = Math.floor(nota.mtimeMs || 0); 
        const mtimeAnterior = estadoAnterior.get(nota.ruta);
        
        if (!mtimeAnterior || mtimeAnterior !== mtimeMsNota) {
            // Es nueva o fue modificada
            if (mtimeAnterior) {
                 // Fue modificada: borrar vectores viejos en LanceDB antes de insertar los nuevos
                 await eliminarDocumentosPorRuta(nota.ruta);
            }
            notasAProcesar.push(nota);
        }
    }
    
    // Buscar archivos eliminados en la bóveda
    // (Solo hacemos esto si estamos haciendo un sync global, no de una sola carpeta)
    if (!carpeta && !forzarReset) {
        for (const rutaVieja of estadoAnterior.keys()) {
            if (!rutasEnBoveda.has(rutaVieja)) {
                // El archivo ya no existe físicamente, eliminar sus vectores y estado
                await eliminarDocumentosPorRuta(rutaVieja);
                eliminarEstadoSync(rutaVieja);
                eliminadas++;
            }
        }
    }

    if (notasAProcesar.length === 0 && eliminadas === 0) {
        console.log(`[SYNC] Nada que sincronizar. Todo está al día.`);
        onProgress(`✅ Bóveda al día (0 cambios).`);
        return { 
            exito: true, 
            totalNotas: notasFisicas.length, 
            totalChunks: 0, 
            tiempo: ((Date.now() - tStart) / 1000).toFixed(1),
            mensaje: "Sin cambios"
        };
    }

    // 5. Generar chunks SOLAMENTE de las notas a procesar
    onProgress(`Vectorizando ${notasAProcesar.length} notas cambiadas...`);
    const todosLosChunks = [];

    for (const nota of notasAProcesar) {
        const chunks = dividirEnChunks(nota.contenido, nota.nombre, nota.ruta);
        todosLosChunks.push(...chunks);
    }
    
    if (todosLosChunks.length > 0) {
        console.log(`[SYNC] ${todosLosChunks.length} chunks nuevos/modificados a insertar.`);
        await upsertDocumentos(todosLosChunks);
        
        // 6. Actualizar SQLite estado
        let hayMedia = false;
        for (const nota of notasAProcesar) {
            upsertEstadoSync(nota.ruta, Math.floor(nota.mtimeMs || 0));
            if (nota.ruta.includes('Media') || nota.ruta.includes('Media\\')) hayMedia = true;
        }

        // 7. Disparar Semantic Bridge si hubo notas de Media nuevas
        if (hayMedia) {
            const { enqueue } = require('../services/gpuQueueService');
            // Encolamos el Bridge para analizar estas nuevas notas
            enqueue('semantic_bridge', 3, { notasAnalizadas: notasAProcesar.filter(n => n.ruta.includes('Media')).map(n => n.ruta) });
            console.log(`[SYNC] 🌉 Evento disparado: Semantic Bridge encolado en GPU Queue.`);
        }
    }

    const totalEnDB = await contarDocumentos();
    const tiempoTotal = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[SYNC] ✅ Sincronización Incremental completada: ${notasAProcesar.length} actualizados, ${eliminadas} borrados. Total docs: ${totalEnDB} [${tiempoTotal}s]`);

    return {
        exito: true,
        totalNotas: notasFisicas.length,
        totalChunks: todosLosChunks.length,
        totalEnDB,
        tiempo: parseFloat(tiempoTotal),
        mensaje: `Actualizadas: ${notasAProcesar.length}, Eliminadas: ${eliminadas}`
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

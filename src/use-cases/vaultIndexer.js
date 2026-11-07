/**
 * src/use-cases/vaultIndexer.js
 *
 * Única responsabilidad: leer la Bóveda de Obsidian, verificar el Hash Cognitivo de Sustancia
 * (ignorando zonas de máquina <!-- auto:begin --> y backlinks automáticos), dividir el contenido
 * sustantivo en chunks lógicos y guardarlos en LanceDB con sus embeddings 4096d.
 */

const crypto = require('crypto');
const { leerVaultRecursivo } = require('../repositories/vaultRepository');
const { upsertDocumentos, limpiarColeccion, contarDocumentos, estaDisponible, eliminarDocumentosPorRuta } = require('../repositories/vectorRepository');
const { obtenerEstadoSync, upsertEstadoSync, eliminarEstadoSync, limpiarEstadoSync } = require('../repositories/syncRepository');
const { VAULT_PATH_BOVEDA } = require('../config/env');

/**
 * Calcula el Hash Cognitivo (SHA-256) únicamente sobre el contenido sustantivo de la nota,
 * ignorando metadatos de máquina, bloques <!-- auto:begin -->...<!-- auto:end -->,
 * timestamps de rendimiento y bloques de Conexiones Cerebrales inyectados en Media/.
 */
function calcularHashSustancia(contenido) {
    const sustantivo = String(contenido || '')
        .replace(/<!-- auto:begin -->[\s\S]*?<!-- auto:end -->/g, '')
        .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
        .replace(/(?:\r?\n---\r?\n+|\r?\n)*## 🧠 Conexiones Cerebrales[\s\S]*?(?=\r?\n---\r?\n|\r?\n## |$)/g, '')
        .replace(/(?:\r?\n---\r?\n+|\r?\n)*## ⏱️ Rendimiento del Análisis Profundo[\s\S]*$/g, '')
        .replace(/^\s*---\s*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    return crypto.createHash('sha256').update(sustantivo).digest('hex');
}

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
 * Divide el contenido de un archivo .md en chunks lógicos excluyendo zonas de máquina y telemetría.
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

    // Excluir zonas de máquina (auto:begin/end) y telemetría de tiempos para evitar ruido vectorial
    const contenidoLimpio = String(contenido || '')
        .replace(/<!-- auto:begin -->[\s\S]*?<!-- auto:end -->/g, '')
        .replace(/---\r?\n+## ⏱️ Rendimiento del Análisis Profundo[\s\S]*$/g, '')
        .replace(/## ⏱️ Rendimiento del Análisis Profundo[\s\S]*$/g, '');

    // Paso 1: Dividir por encabezados markdown (##, ###, ####)
    const secciones = contenidoLimpio.split(/(?=^#{2,4}\s)/m);

    for (const seccion of secciones) {
        const limpio = seccion.trim();
        if (limpio.length < MIN_CHUNK_LENGTH) continue;

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
 * Ejecuta la sincronización incremental de la Bóveda a LanceDB guiada por Hash Cognitivo.
 */
async function sincronizarBoveda({ forzarReset = false, carpeta = null, onProgress = () => {} } = {}) {
    const tStart = Date.now();

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

    if (forzarReset) {
        onProgress('Limpiando colección anterior...');
        await limpiarColeccion();
        limpiarEstadoSync();
        console.log('[SYNC] Colección y estado limpiados — reset forzado.');
    }

    onProgress('Analizando Bóveda...');
    const dirLectura = carpeta
        ? require('path').join(VAULT_PATH_BOVEDA || '', carpeta)
        : undefined;

    const notasFisicas = leerVaultRecursivo(dirLectura);
    console.log(`[SYNC] ${notasFisicas.length} notas detectadas en disco.`);

    // 4. Lógica Incremental con Hash Cognitivo de Sustancia
    const estadoAnterior = obtenerEstadoSync(); // Map<ruta, {mtimeMs, hashSustancia}>
    const notasAProcesar = [];
    const rutasEnBoveda = new Set();
    let omitidasPorHash = 0;
    let eliminadas = 0;
    
    for (const nota of notasFisicas) {
        rutasEnBoveda.add(nota.ruta);
        const mtimeMsNota = Math.floor(nota.mtimeMs || 0);
        const regAnterior = estadoAnterior.get(nota.ruta);
        const mtimeAnterior = regAnterior ? regAnterior.mtimeMs : null;
        const hashAnterior = regAnterior ? regAnterior.hashSustancia : '';

        if (!mtimeAnterior || mtimeAnterior !== mtimeMsNota) {
            const hashActual = calcularHashSustancia(nota.contenido);
            nota.hashSustancia = hashActual;

            if (mtimeAnterior && hashAnterior && hashAnterior === hashActual) {
                // El archivo fue tocado en disco pero SOLO en su zona <!-- auto:begin --> o enlaces automáticos.
                // Actualizamos mtimeMs en SQLite silenciosamente sin re-vectorizar ni disparar el Bridge.
                upsertEstadoSync(nota.ruta, mtimeMsNota, hashActual);
                omitidasPorHash++;
                continue;
            }

            if (mtimeAnterior) {
                await eliminarDocumentosPorRuta(nota.ruta);
            }
            notasAProcesar.push(nota);
        }
    }
    
    if (!carpeta && !forzarReset) {
        for (const rutaVieja of estadoAnterior.keys()) {
            if (!rutasEnBoveda.has(rutaVieja)) {
                await eliminarDocumentosPorRuta(rutaVieja);
                eliminarEstadoSync(rutaVieja);
                eliminadas++;
            }
        }
    }

    if (notasAProcesar.length === 0 && eliminadas === 0) {
        if (omitidasPorHash > 0) {
            console.log(`[SYNC] ⚡ ${omitidasPorHash} archivo(s) actualizados solo en metadatos/auto-bloque (sustancia intacta, 0 re-vectorizaciones).`);
        } else {
            console.log(`[SYNC] Nada que sincronizar. Todo está al día.`);
        }
        onProgress(`✅ Bóveda al día (0 cambios sustantivos).`);
        return { 
            exito: true, 
            totalNotas: notasFisicas.length, 
            totalChunks: 0, 
            tiempo: ((Date.now() - tStart) / 1000).toFixed(1),
            mensaje: "Sin cambios sustantivos"
        };
    }

    // 5. Generar chunks SOLAMENTE de las notas con cambio sustantivo real
    onProgress(`Vectorizando ${notasAProcesar.length} notas con cambios sustantivos...`);
    const todosLosChunks = [];

    for (const nota of notasAProcesar) {
        const chunks = dividirEnChunks(nota.contenido, nota.nombre, nota.ruta);
        todosLosChunks.push(...chunks);
    }
    
    if (todosLosChunks.length > 0) {
        console.log(`[SYNC] ${todosLosChunks.length} chunks nuevos/modificados a insertar.`);
        await upsertDocumentos(todosLosChunks);
        
        for (const nota of notasAProcesar) {
            const hash = nota.hashSustancia || calcularHashSustancia(nota.contenido);
            upsertEstadoSync(nota.ruta, Math.floor(nota.mtimeMs || 0), hash);
        }
        // NOTA ARQUITECTÓNICA (Pilar III):
        // Las notas crudas de Media/ NUNCA disparan el Semantic Bridge desde vault_sync.
        // El Semantic Bridge es disparado una única vez por El Vigilante cuando el concepto ha sido curado o ampliado.
    }

    const totalEnDB = await contarDocumentos();
    const tiempoTotal = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[SYNC] ✅ Sincronización Incremental completada: ${notasAProcesar.length} sustantivos actualizados (${omitidasPorHash} auto-bloques omitidos), ${eliminadas} borrados. Total docs: ${totalEnDB} [${tiempoTotal}s]`);

    return {
        exito: true,
        totalNotas: notasFisicas.length,
        totalChunks: todosLosChunks.length,
        totalEnDB,
        tiempo: parseFloat(tiempoTotal),
        mensaje: `Actualizadas: ${notasAProcesar.length}, Omitidas(auto): ${omitidasPorHash}, Eliminadas: ${eliminadas}`
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

module.exports = { sincronizarBoveda, obtenerEstadoVectorial, calcularHashSustancia };

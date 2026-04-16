/**
 * VaultService — Interaccion exclusiva con el vault de Obsidian.
 *
 * CHANGELOG v3:
 *   - buscarContexto()        Acepta umbral configurable (default 0.5 para RAG general).
 *   - buscarCandidatosFusion() NUEVO. Umbral alto (default 0.78) + devuelve candidatos
 *                              con ruta absoluta para que el conserje pueda fusionar.
 *                              Separa semanticamente "buscar contexto informativo"
 *                              de "buscar archivo candidato para fusionar".
 *
 * UMBRAL DE FUSION: 0.78 (configurable via VAULT_UMBRAL_FUSION en .env)
 *   - nomic-embed-text reporta similitudes 0.6-0.95 para textos relacionados
 *   - 0.5 es apropiado para RAG informativo (captura contexto amplio)
 *   - 0.78 exige alta certeza semantica antes de proponer fusion
 *   - Ajustable segun comportamiento observado con el propio vault
 */

const fs   = require('fs');
const path = require('path');
const { VAULT_PATH } = require('../config/env');
const { generarEmbedding } = require('./llmService');

// Umbral de fusion: configurable sin tocar codigo
const UMBRAL_FUSION = parseFloat(process.env.VAULT_UMBRAL_FUSION || '0.78');

// ============================================================
// HELPERS
// ============================================================

function asegurarDirectorio(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// ============================================================
// LECTURA
// ============================================================

function leerVaultRecursivo(dir = VAULT_PATH) {
    const resultados = [];
    try {
        const entradas = fs.readdirSync(dir, { withFileTypes: true });
        for (const entrada of entradas) {
            const rutaCompleta = path.join(dir, entrada.name);
            if (entrada.isDirectory()) {
                if (entrada.name.startsWith('.') || entrada.name === 'node_modules' || entrada.name === 'Inbox') continue;
                resultados.push(...leerVaultRecursivo(rutaCompleta));
            } else if (entrada.name.endsWith('.md')) {
                try {
                    const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
                    resultados.push({
                        ruta:     rutaCompleta.replace(VAULT_PATH, ''),
                        nombre:   path.basename(rutaCompleta, '.md'),
                        contenido
                    });
                } catch (err) {
                    console.error(`[WARN] No se pudo leer ${rutaCompleta}: ${err.message}`);
                }
            }
        }
    } catch (err) {
        console.error(`[WARN] No se pudo acceder a ${dir}: ${err.message}`);
    }
    return resultados;
}

function obtenerCategorias() {
    try {
        return leerVaultRecursivo().map(n => n.nombre);
    } catch {
        return [];
    }
}

// ============================================================
// RAG VECTORIAL
// ============================================================

const vectorCache = new Map();

function similitudCoseno(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot   += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function obtenerVectorCacheado(texto) {
    if (vectorCache.has(texto)) return vectorCache.get(texto);
    const vector = await generarEmbedding(texto);
    vectorCache.set(texto, vector);
    return vector;
}

/**
 * Busqueda semantica general para RAG informativo.
 * Umbral bajo (0.5 por defecto) — captura contexto amplio.
 * Usar para responder preguntas, no para decidir fusiones.
 *
 * @param {string} pregunta
 * @param {number} maxFragmentos
 * @param {number} umbral        - Configurable. Default 0.5.
 */
async function buscarContexto(pregunta, maxFragmentos = 5, umbral = 0.5) {
    const notas = leerVaultRecursivo();
    if (notas.length === 0) return [];

    console.log(`[RAG] Vectorizando query...`);
    const vectorPregunta = await generarEmbedding(pregunta);
    const fragmentosPuntuados = [];

    for (const nota of notas) {
        const secciones = nota.contenido.split('\n\n');
        for (const seccion of secciones) {
            const textoLimpio = seccion.trim();
            if (textoLimpio.length < 40) continue;
            const vectorSeccion = await obtenerVectorCacheado(textoLimpio);
            const score = similitudCoseno(vectorPregunta, vectorSeccion);
            if (score > umbral) {
                fragmentosPuntuados.push({
                    fuente: `${nota.nombre} (${nota.ruta})`,
                    texto:  textoLimpio.substring(0, 800),
                    score
                });
            }
        }
    }

    fragmentosPuntuados.sort((a, b) => b.score - a.score);
    return fragmentosPuntuados.slice(0, maxFragmentos);
}

/**
 * Busqueda semantica para candidatos de FUSION.
 * Umbral alto (UMBRAL_FUSION, default 0.78) — solo candidatos con alta certeza.
 * Devuelve ademas la ruta absoluta del archivo para que el conserje pueda escribirlo.
 *
 * SEPARACION DE RESPONSABILIDADES:
 *   buscarContexto()         → RAG informativo (responder preguntas)
 *   buscarCandidatosFusion() → decidir si FUSIONAR o CREAR (conserje)
 *
 * La diferencia no es solo el umbral. El resultado incluye rutaAbsoluta y
 * toda la nota (no solo un fragmento) para que verificarFusion() tenga contexto completo.
 *
 * @param {string} texto        - Contenido de la nota del Inbox
 * @param {number} maxCandidatos
 * @returns {Array<{nombre, ruta, rutaAbsoluta, fragmento, notaCompleta, score}>}
 */
async function buscarCandidatosFusion(texto, maxCandidatos = 3) {
    const notas = leerVaultRecursivo();
    if (notas.length === 0) return [];

    console.log(`[RAG FUSION] Buscando candidatos con umbral ${UMBRAL_FUSION}...`);
    const vectorTexto = await generarEmbedding(texto.substring(0, 600));
    const candidatos  = [];

    for (const nota of notas) {
        // Vectorizar primero parrafos de la nota para maxima precision
        const secciones = nota.contenido.split('\n\n');
        let maxScore = 0;
        let mejorSeccion = '';

        for (const seccion of secciones) {
            const limpio = seccion.trim();
            if (limpio.length < 40) continue;
            const vectorSeccion = await obtenerVectorCacheado(limpio);
            const score = similitudCoseno(vectorTexto, vectorSeccion);
            if (score > maxScore) {
                maxScore     = score;
                mejorSeccion = limpio;
            }
        }

        if (maxScore >= UMBRAL_FUSION) {
            candidatos.push({
                nombre:       nota.nombre,
                ruta:         nota.ruta,
                rutaAbsoluta: path.join(VAULT_PATH, nota.ruta),
                fragmento:    mejorSeccion.substring(0, 500),
                notaCompleta: nota.contenido.substring(0, 800),
                score:        maxScore
            });
        }
    }

    candidatos.sort((a, b) => b.score - a.score);
    const resultado = candidatos.slice(0, maxCandidatos);

    if (resultado.length > 0) {
        console.log(`[RAG FUSION] ${resultado.length} candidato(s) encontrado(s): ${resultado.map(c => `${c.nombre} (${c.score.toFixed(3)})`).join(', ')}`);
    } else {
        console.log(`[RAG FUSION] Sin candidatos sobre el umbral ${UMBRAL_FUSION} → CREAR nota nueva.`);
    }

    return resultado;
}

// ============================================================
// ESCRITURA
// ============================================================

function escribirIdeaEnVault(categoria, idea, timestamp, rutaEspecifica = null) {
    let archivoDestino;

    if (rutaEspecifica) {
        archivoDestino = path.join(VAULT_PATH, rutaEspecifica);
        asegurarDirectorio(path.dirname(archivoDestino));
    } else {
        const notas    = leerVaultRecursivo();
        const notaReal = notas.find(n => n.nombre.toLowerCase() === categoria.toLowerCase());

        if (notaReal) {
            archivoDestino = path.join(VAULT_PATH, notaReal.ruta);
        } else {
            const inboxDir = path.join(VAULT_PATH, 'Inbox');
            asegurarDirectorio(inboxDir);
            archivoDestino = path.join(inboxDir, `${categoria}.md`);

            if (!fs.existsSync(archivoDestino)) {
                const frontmatter = [
                    '---', `tipo: categoria_nueva`, `creado: ${timestamp}`,
                    `fuente: webhook_cerebro`, `revisado: false`,
                    '---', `# ${categoria}`, '',
                    '> Nota creada automaticamente por Arturo.', ''
                ].join('\n');
                fs.writeFileSync(archivoDestino, frontmatter);
                console.log(`[INBOX] Nueva categoria creada: Inbox/${categoria}.md`);
            }
        }
    }

    fs.appendFileSync(archivoDestino, `\n- [${timestamp}] ${idea}`);
    console.log(`[VAULT] Idea guardada en: ${archivoDestino.replace(VAULT_PATH, '')}`);
}

function crearNotaEstructurada({ titulo, contenido, carpeta = 'Inbox', tipo = 'nota', timestamp }) {
    const nombreArchivo = titulo
        .replace(/[^a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1\u00fc\u00dc0-9\s_-]/g, '')
        .trim().replace(/\s+/g, '_');
    const dirDestino     = path.join(VAULT_PATH, carpeta);
    asegurarDirectorio(dirDestino);
    const archivoDestino = path.join(dirDestino, `${nombreArchivo}.md`);

    if (fs.existsSync(archivoDestino)) {
        console.warn(`[VAULT] "${nombreArchivo}.md" ya existe en ${carpeta}/. No se sobreescribio.`);
        return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: false };
    }

    const frontmatter = ['---', `tipo: ${tipo}`, `creado: ${timestamp}`, `fuente: IA_nota`, '---', `# ${titulo}`, ''].join('\n');
    fs.writeFileSync(archivoDestino, frontmatter + contenido);
    console.log(`[VAULT] Nota estructurada creada: ${carpeta}/${nombreArchivo}.md`);
    return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: true };
}

// ============================================================
// GRAFO
// ============================================================

function generarGrafoJSON() {
    const notas = leerVaultRecursivo();
    const nodes = [], links = [];
    const regexEnlaces = /\[\[(.*?)\]\]/g;

    for (const nota of notas) {
        const dir   = path.dirname(nota.ruta).replace(/\\/g, '/');
        const grupo = (dir === '.' || dir === '/' || dir === '') ? 'Cerebro/Raiz' : dir.replace(/^\//, '');
        nodes.push({ id: nota.nombre, grupo });
        let match;
        while ((match = regexEnlaces.exec(nota.contenido)) !== null) {
            links.push({ source: nota.nombre, target: match[1].split('|')[0].trim() });
        }
    }
    return { nodes, links };
}

function obtenerEstadisticasGrafo() {
    const { nodes, links } = generarGrafoJSON();
    const entrantes = {}, salientes = {};
    for (const n of nodes) { entrantes[n.id] = 0; salientes[n.id] = 0; }
    for (const l of links) {
        if (entrantes[l.target] !== undefined) entrantes[l.target]++;
        if (salientes[l.source] !== undefined) salientes[l.source]++;
    }
    const huerfanos = nodes.filter(n => entrantes[n.id] === 0 && salientes[n.id] === 0).map(n => n.id);
    const hubs      = nodes.map(n => ({ id: n.id, entrantes: entrantes[n.id], salientes: salientes[n.id] }))
        .sort((a, b) => b.entrantes - a.entrantes).slice(0, 5);
    const porCarpeta = {};
    for (const n of nodes) porCarpeta[n.grupo] = (porCarpeta[n.grupo] || 0) + 1;
    return { total_nodos: nodes.length, total_enlaces: links.length, hubs, huerfanos, por_carpeta: porCarpeta };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    obtenerCategorias,
    escribirIdeaEnVault,
    crearNotaEstructurada,
    leerVaultRecursivo,
    buscarContexto,
    buscarCandidatosFusion,
    generarGrafoJSON,
    obtenerEstadisticasGrafo,
    UMBRAL_FUSION
};
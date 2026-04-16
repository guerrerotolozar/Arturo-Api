/**
 * VaultService — Encargado EXCLUSIVO de interactuar con el sistema de archivos
 * del vault de Obsidian (Segundo Cerebro).
 *
**/

const fs = require('fs');
const path = require('path');
const { VAULT_PATH } = require('../config/env');
const { generarEmbedding } = require('./llmService');

// ============================================================
// HELPERS INTERNOS
// ============================================================

/**
 * Garantiza que un directorio exista, creándolo recursivamente si hace falta.
 * @param {string} dirPath
 */
function asegurarDirectorio(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ============================================================
// LECTURA DEL VAULT
// ============================================================

/**
 * Lee recursivamente todos los archivos .md dentro del vault.
 * Ignora carpetas ocultas (como .obsidian).
 * @param {string} dir
 * @returns {Array<{ruta: string, nombre: string, contenido: string}>}
 */
function leerVaultRecursivo(dir = VAULT_PATH) {
    const resultados = [];

    try {
        const entradas = fs.readdirSync(dir, { withFileTypes: true });

        for (const entrada of entradas) {
            const rutaCompleta = path.join(dir, entrada.name);

            if (entrada.isDirectory()) {
                if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
                resultados.push(...leerVaultRecursivo(rutaCompleta));
            } else if (entrada.name.endsWith('.md')) {
                try {
                    const contenido = fs.readFileSync(rutaCompleta, 'utf-8');
                    resultados.push({
                        ruta: rutaCompleta.replace(VAULT_PATH, ''),
                        nombre: path.basename(rutaCompleta, '.md'),
                        contenido
                    });
                } catch (err) {
                    console.error(`[WARN] No se pudo leer ${rutaCompleta}: ${err.message}`);
                }
            }
        }
    } catch (err) {
        console.error(`[WARN] No se pudo acceder al directorio ${dir}: ${err.message}`);
    }

    return resultados;
}

// ============================================================
// BUG 1 FIX — obtenerCategorias (recursivo, sin hardcodeo)
// ============================================================

/**
 * Devuelve los nombres de TODAS las notas .md del vault, sin importar en qué
 * subcarpeta vivan. Si el vault está vacío o hay un error, devuelve [].
 * La IA tiene libertad total para crear categorías nuevas.
 * @returns {string[]}
 */
function obtenerCategorias() {
    try {
        const notas = leerVaultRecursivo();
        return notas.map(n => n.nombre);
    } catch {
        return [];
    }
}

// ============================================================
// BUG 2 FIX — escribirIdeaEnVault (recursivo + Inbox como fallback)
// ============================================================

/**
 * Escribe una idea en la nota correcta del vault.
 *   1. Busca la nota por nombre recursivamente (respeta reorganizaciones de carpetas).
 *   2. Si la nota no existe, la crea en /Inbox/ con frontmatter YAML básico.
 *   3. Si la IA pasó una rutaEspecifica, la respeta por encima de todo.
 *
 * @param {string} categoria   - Nombre de la nota destino (sin extensión)
 * @param {string} idea        - Texto de la idea
 * @param {string} timestamp   - Timestamp formateado
 * @param {string|null} rutaEspecifica - Ruta relativa opcional (ej: 'Finanzas/NuevaCategoria.md')
 */
function escribirIdeaEnVault(categoria, idea, timestamp, rutaEspecifica = null) {
    let archivoDestino;

    if (rutaEspecifica) {
        // La IA especificó una ruta concreta — respetar al 100%
        archivoDestino = path.join(VAULT_PATH, rutaEspecifica);
        asegurarDirectorio(path.dirname(archivoDestino));

    } else {
        // Buscar la nota real en el vault (recursivo)
        const notas = leerVaultRecursivo();
        const notaReal = notas.find(n =>
            n.nombre.toLowerCase() === categoria.toLowerCase()
        );

        if (notaReal) {
            // Nota encontrada en su ruta actual — appendear ahí
            archivoDestino = path.join(VAULT_PATH, notaReal.ruta);

        } else {
            // Nota nueva — crear en /Inbox/ con frontmatter
            const inboxDir = path.join(VAULT_PATH, 'Inbox');
            asegurarDirectorio(inboxDir);
            archivoDestino = path.join(inboxDir, `${categoria}.md`);

            if (!fs.existsSync(archivoDestino)) {
                const frontmatter = [
                    '---',
                    `tipo: categoria_nueva`,
                    `creado: ${timestamp}`,
                    `fuente: webhook_cerebro`,
                    `revisado: false`,
                    '---',
                    `# ${categoria}`,
                    '',
                    '> Nota creada automáticamente por Arturo. Mover a la carpeta correcta cuando sea relevante.',
                    ''
                ].join('\n');
                fs.writeFileSync(archivoDestino, frontmatter);
                console.log(`[INBOX] Nueva categoría creada: Inbox/${categoria}.md`);
            }
        }
    }

    const entrada = `\n- [${timestamp}] ${idea}`;
    fs.appendFileSync(archivoDestino, entrada);
    console.log(`[VAULT] Idea guardada en: ${archivoDestino.replace(VAULT_PATH, '')}`);
}

// ============================================================
// NUEVO — crearNotaEstructurada (para /IA/nota)
// ============================================================

/**
 * Crea una nota .md completa con frontmatter, título y contenido.
 * Si la ruta ya existe, lanza un error (no sobreescribe sin aviso).
 *
 * @param {object} params
 * @param {string} params.titulo     - Título de la nota (también nombre del archivo)
 * @param {string} params.contenido  - Cuerpo en Markdown
 * @param {string} params.carpeta    - Subcarpeta relativa dentro del vault (ej: 'Finanzas')
 * @param {string} params.tipo       - Valor del campo `tipo:` en el frontmatter
 * @param {string} params.timestamp  - Timestamp de creación
 * @returns {{ ruta: string, creada: boolean }}
 */
function crearNotaEstructurada({ titulo, contenido, carpeta = 'Inbox', tipo = 'nota', timestamp }) {
    const nombreArchivo = titulo.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_');
    const dirDestino = path.join(VAULT_PATH, carpeta);

    asegurarDirectorio(dirDestino);

    const archivoDestino = path.join(dirDestino, `${nombreArchivo}.md`);
    const yaExiste = fs.existsSync(archivoDestino);

    if (yaExiste) {
        console.warn(`[VAULT] La nota "${nombreArchivo}.md" ya existe en ${carpeta}/. No se sobreescribió.`);
        return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: false };
    }

    const frontmatter = [
        '---',
        `tipo: ${tipo}`,
        `creado: ${timestamp}`,
        `fuente: IA_nota`,
        '---',
        `# ${titulo}`,
        ''
    ].join('\n');

    fs.writeFileSync(archivoDestino, frontmatter + contenido);
    console.log(`[VAULT] Nota estructurada creada: ${carpeta}/${nombreArchivo}.md`);

    return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: true };
}

// ============================================================
// RAG — buscarContexto
// ============================================================

/**
 * Extrae fragmentos relevantes del vault basándose en palabras clave de la pregunta.
 * @param {string} pregunta
 * @param {number} maxFragmentos
 * @returns {Array<{fuente: string, texto: string, score: number}>}
 */

// ============================================================
// RAG VECTORIAL — buscarContexto (Cero LangChain)
// ============================================================

// Memoria caché en RAM para no pedirle el mismo vector a Ollama dos veces
const vectorCache = new Map();

/**
 * Fórmula matemática para calcular qué tan cerca apuntan dos vectores en el espacio 3D.
 * 1.0 = Son idénticos (el mismo significado). 0.0 = No tienen nada que ver.
 */
function similitudCoseno(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Obtiene el vector de un texto, usando la caché de RAM si ya existe.
 */
async function obtenerVectorCacheados(texto) {
    if (vectorCache.has(texto)) return vectorCache.get(texto);
    const vector = await generarEmbedding(texto);
    vectorCache.set(texto, vector);
    return vector;
}

/**
 * Búsqueda semántica usando Álgebra Lineal.
 */
async function buscarContexto(pregunta, maxFragmentos = 5) {
    const notas = leerVaultRecursivo();
    if (notas.length === 0) return [];

    console.log(`[RAG] Vectorizando pregunta...`);
    const vectorPregunta = await generarEmbedding(pregunta);
    const fragmentosPuntuados = [];

    console.log(`[RAG] Analizando espacio latente de ${notas.length} notas...`);
    
    for (const nota of notas) {
        // Dividimos la nota por párrafos o secciones
        const secciones = nota.contenido.split('\n\n'); 
        
        for (const seccion of secciones) {
            const textoLimpio = seccion.trim();
            // Ignorar basura muy corta que ensucia el RAG
            if (textoLimpio.length < 40) continue; 

            // Convertimos la sección a números (usa caché si ya lo hizo antes)
            const vectorSeccion = await obtenerVectorCacheados(textoLimpio);
            
            // Calculamos la similitud de conceptos
            const score = similitudCoseno(vectorPregunta, vectorSeccion);

            // Umbral de 0.5 (depende del modelo, Nomic suele dar valores altos)
            if (score > 0.5) {
                fragmentosPuntuados.push({
                    fuente: `${nota.nombre} (${nota.ruta})`,
                    texto: textoLimpio.substring(0, 800),
                    score: score
                });
            }
        }
    }

    // Ordenamos de mayor similitud a menor
    fragmentosPuntuados.sort((a, b) => b.score - a.score);
    return fragmentosPuntuados.slice(0, maxFragmentos);
}

// ============================================================
// GRAFO 3D
// ============================================================

/**
 * Genera el JSON de nodos y enlaces para el grafo 3D.
 */
function generarGrafoJSON() {
    const notas = leerVaultRecursivo();
    const nodes = [];
    const links = [];
    const regexEnlaces = /\[\[(.*?)\]\]/g;

    for (const nota of notas) {
        let dir = path.dirname(nota.ruta).replace(/\\/g, '/');
        let grupo = (dir === '.' || dir === '/' || dir === '') ? 'Cerebro/Raíz' : dir.replace(/^\//, '');

        nodes.push({ id: nota.nombre, grupo });

        let match;
        while ((match = regexEnlaces.exec(nota.contenido)) !== null) {
            const targetReal = match[1].split('|')[0].trim();
            links.push({ source: nota.nombre, target: targetReal });
        }
    }

    return { nodes, links };
}

/**
 * Estadísticas del grafo: hubs, huérfanos y conteo por carpeta.
 * Endpoint: GET /api/grafo/stats
 */
function obtenerEstadisticasGrafo() {
    const { nodes, links } = generarGrafoJSON();

    // Contar conexiones entrantes por nodo
    const contadorEntrantes = {};
    for (const node of nodes) contadorEntrantes[node.id] = 0;
    for (const link of links) {
        if (contadorEntrantes[link.target] !== undefined) {
            contadorEntrantes[link.target]++;
        }
    }

    // Contar conexiones salientes por nodo
    const contadorSalientes = {};
    for (const node of nodes) contadorSalientes[node.id] = 0;
    for (const link of links) {
        if (contadorSalientes[link.source] !== undefined) {
            contadorSalientes[link.source]++;
        }
    }

    // Nodos huérfanos: 0 entrantes Y 0 salientes
    const huerfanos = nodes
        .filter(n => contadorEntrantes[n.id] === 0 && contadorSalientes[n.id] === 0)
        .map(n => n.id);

    // Top 5 hubs (más conexiones entrantes)
    const hubs = nodes
        .map(n => ({ id: n.id, entrantes: contadorEntrantes[n.id], salientes: contadorSalientes[n.id] }))
        .sort((a, b) => b.entrantes - a.entrantes)
        .slice(0, 5);

    // Nodos por carpeta/grupo
    const porCarpeta = {};
    for (const node of nodes) {
        porCarpeta[node.grupo] = (porCarpeta[node.grupo] || 0) + 1;
    }

    return {
        total_nodos: nodes.length,
        total_enlaces: links.length,
        hubs,
        huerfanos,
        por_carpeta: porCarpeta
    };
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
    generarGrafoJSON,
    obtenerEstadisticasGrafo
};
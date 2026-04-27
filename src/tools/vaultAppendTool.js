/**
 * src/tools/vaultAppendTool.js — Escritura inteligente al Segundo Cerebro.
 *
 * ESTRATEGIA DE RESOLUCIÓN DE NOTA (en orden de prioridad):
 *   1. Match exacto por nombre de archivo (case-insensitive)
 *   2. Match por alias en frontmatter YAML (nombre_servidor, nombre, etc.)
 *   3. Match por heading principal (# Título)
 *   4. Match por wikilinks que la nota contiene ([[Concepto]])
 *   5. Match por scoring heurístico de contenido (keywords en el cuerpo)
 *
 * Si el usuario dice "anota en la torre" pero el archivo se llama "Torre.md",
 * o dice "agrega a mis suscripciones" y el archivo es "Suscripciones Tech.md",
 * este motor lo encontrará sin necesidad de que el usuario diga el nombre exacto.
 *
 * Principio: SOLO APPEND. Nunca sobreescribe. Es un parche al final.
 */

const path = require('path');
const { VAULT_PATH, leerVaultRecursivo, appendArchivo } = require('../repositories/vaultRepository');
const { extraerURL, scrapearURL } = require('../utils/urlScraper');
const { llamarOllama } = require('../adapters/ollamaAdapter');
const { OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP } = require('../config/env');
const { switchTo, liberarVRAM } = require('../services/vramManagerService');

// ══════════════════════════════════════════════════════════════════
// MOTOR DE RESOLUCIÓN INTELIGENTE
// ══════════════════════════════════════════════════════════════════

/**
 * Extrae metadatos útiles de una nota para matching.
 * @param {object} nota - { ruta, nombre, contenido }
 * @returns {object} - { nombre, aliases, heading, wikilinks, tags }
 */
function extraerMetadatos(nota) {
    const meta = {
        nombre: nota.nombre.toLowerCase(),
        aliases: [],
        heading: '',
        wikilinks: [],
        tags: []
    };

    const lines = nota.contenido.split('\n');
    let inFrontmatter = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // --- Frontmatter YAML ---
        if (trimmed === '---') {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (inFrontmatter) {
            // Extraer valores clave del frontmatter como aliases
            const match = trimmed.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, val] = match;
                const cleanVal = val.replace(/["\[\]]/g, '').trim().toLowerCase();
                // Campos que actúan como "nombres alternativos"
                if (['nombre', 'nombre_servidor', 'alias', 'titulo'].includes(key.toLowerCase())) {
                    meta.aliases.push(cleanVal);
                }
                if (key === 'tags') {
                    meta.tags = cleanVal.split(',').map(t => t.trim());
                }
            }
            continue;
        }

        // --- Heading principal (primer # encontrado) ---
        if (!meta.heading && trimmed.startsWith('# ')) {
            // Limpiar emojis y espacios extra
            meta.heading = trimmed.replace(/^#+\s*/, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim().toLowerCase();
        }

        // --- Wikilinks [[]] ---
        const wikiMatches = trimmed.matchAll(/\[\[([^\]]+)\]\]/g);
        for (const wm of wikiMatches) {
            meta.wikilinks.push(wm[1].toLowerCase());
        }
    }

    return meta;
}

/**
 * Calcula un score de coincidencia entre una consulta y una nota.
 * Más alto = más probable que sea la nota correcta.
 */
function calcularScore(query, nota, metadatos) {
    const q = query.toLowerCase().trim();
    const qWords = q.split(/\s+/).filter(w => w.length > 2);
    let score = 0;

    // 1. Match EXACTO por nombre de archivo (máxima prioridad)
    if (metadatos.nombre === q) return 100;

    // 2. Match parcial por nombre de archivo
    if (metadatos.nombre.includes(q) || q.includes(metadatos.nombre)) score += 30;

    // 3. Match por alias de frontmatter
    for (const alias of metadatos.aliases) {
        if (alias === q) return 95;
        if (alias.includes(q) || q.includes(alias)) score += 25;
    }

    // 4. Match por heading principal
    if (metadatos.heading) {
        if (metadatos.heading === q) return 90;
        if (metadatos.heading.includes(q) || q.includes(metadatos.heading)) score += 20;
        // Palabras individuales del query en el heading
        for (const w of qWords) {
            if (metadatos.heading.includes(w)) score += 8;
        }
    }

    // 5. Match por wikilinks (si la nota es referenciada con ese nombre)
    for (const wl of metadatos.wikilinks) {
        if (wl === q) score += 15;
        for (const w of qWords) {
            if (wl.includes(w)) score += 3;
        }
    }

    // 6. Match por tags del frontmatter
    for (const tag of metadatos.tags) {
        for (const w of qWords) {
            if (tag.includes(w)) score += 5;
        }
    }

    // 7. Scoring heurístico por palabras en el contenido
    const contenidoLower = nota.contenido.toLowerCase();
    for (const w of qWords) {
        const count = (contenidoLower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;
        score += Math.min(count * 2, 10); // Cap 10 por palabra
    }

    return score;
}

/**
 * Resuelve qué nota del vault es la más relevante para una consulta.
 * @param {string} query - Lo que el usuario quiere (ej: "torre", "suscripciones", "ram")
 * @returns {{ nota: object, score: number } | null}
 */
function resolverNota(query, vaultFiles) {
    let mejorNota = null;
    let mejorScore = 0;

    // Si el LLM explícitamente dice nueva_nota, no buscamos matchs.
    if (query.toLowerCase() === 'nueva_nota') {
        console.log(`[VAULT_APPEND] Query explícito de 'nueva_nota'. Forzando creación.`);
        return null;
    }

    console.log(`[VAULT_APPEND] Resolviendo nota para: "${query}" entre ${vaultFiles.length} archivos`);

    for (const nota of vaultFiles) {
        const meta = extraerMetadatos(nota);
        const score = calcularScore(query, nota, meta);

        if (score > mejorScore) {
            mejorScore = score;
            mejorNota = nota;
        }
    }

    // Se sube el umbral a 75 para evitar que coincida con notas random de OCR (que tenían score ~68)
    if (mejorNota && mejorScore >= 75) {
        console.log(`[VAULT_APPEND] Mejor match: "${mejorNota.nombre}" (score: ${mejorScore})`);
        return { nota: mejorNota, score: mejorScore };
    }

    console.log(`[VAULT_APPEND] No se encontró match suficiente (mejor score: ${mejorScore})`);
    return null;
}

// ══════════════════════════════════════════════════════════════════
// TOOL EXPORT
// ══════════════════════════════════════════════════════════════════

module.exports = {
    nombre: 'vault_append',
    descripcion: `ANOTA, GUARDA o AGREGA informacion nueva al Segundo Cerebro de Ronald. `
        + `Usa esta herramienta cuando el usuario diga "anota", "guarda", "agrega", "apunta", "recuerda que..." `
        + `Parametros: "query" (tema o nombre de la nota destino, ej "torre", "suscripciones", "laptop"), `
        + `"contenido" (el texto a agregar). `
        + `Si el usuario no dice donde guardar, infiere el tema del contenido y ponlo en "query". `
        + `El contenido se agrega AL FINAL de la nota, nunca sobreescribe.`,

    async ejecutar(params, onProgress = () => {}) {
        const query = (params.query || params.nota || '').trim();
        let contenido = params.contenido;
        let infoWeb = null;

        if (!query || !contenido) {
            return {
                resumen: `Error: faltan parámetros. Necesito "query" (tema/nota) y "contenido" (lo que se va a anotar).`,
                datos: { exito: false }
            };
        }

        console.log(`[TOOL vault_append] Query: "${query}" | Contenido: "${contenido.substring(0, 80)}..."`);

        // ── PRE-PROCESAMIENTO PROACTIVO: Detectar y enriquecer URLs ──
        // Si Ronald manda un link, Arturo no solo pega el link, sino que
        // entra a la página y extrae título, descripción y precio.
        const urlDetectada = extraerURL(contenido);
        if (urlDetectada) {
            console.log(`[VAULT_APPEND] URL detectada: ${urlDetectada}. Scrapeando...`);
            onProgress(`Scrapeando página web...`);
            const tStartScrape = Date.now();
            try {
                infoWeb = await scrapearURL(urlDetectada);
                console.log(`[VAULT_APPEND] Scrape exitoso ✔️ [ ${((Date.now() - tStartScrape)/1000).toFixed(2)}s ] ("${infoWeb.titulo}")`);
                onProgress(`✅ Web scrapeada. Analizando contenido profundo...`);
                
                const tStartLLM = Date.now();
                console.log(`[VAULT_APPEND] Solicitando formateo inteligente a DEEP model...`);
                
                const promptFormateo = `El usuario Ronald quiere guardar una nota en Obsidian relacionada a la siguiente URL: ${urlDetectada}

A continuación se presentan los datos crudos extraídos de la web o de la imagen:
- Título/Meta: ${infoWeb.titulo}
- Contenido Extraído: ${infoWeb.contenido}

Petición original de Ronald:
"${contenido}"

### Instrucciones para formateo:
1. Extrae y resume las especificaciones, características y precios más importantes de forma profesional y clara (usa viñetas o listas).
2. Usa formato de **Markdown de Obsidian**.
3. Incorpora wikilinks orgánicamente (ejemplo \`[[Concepto]]\`) en los términos importantes, tecnologías o posibles nombres de hardware relevantes. No abuses de los links, sólo usa los que ofrezcan valor conceptual.
4. Si detectas que se habla de un objetivo de hardware o tecnología, puedes referenciar sutilmente usando wikilinks.
5. Inicia el texto con algo amigable y resumido, omitiendo muletillas o frases introductorias conversacionales (No digas "Aquí tienes...", "Claro, ...").
6. Solo devuelve el contenido FINAL que será guardado en el archivo Markdown.

Redacta la nota resultante ahora:`;

                // VRAM Manager: cargar modelo profundo para formateo
                await switchTo(OLLAMA_MODEL_DEEP);
                const markdownInteligente = await llamarOllama(promptFormateo, OLLAMA_MODEL_DEEP);
                await liberarVRAM();
                contenido = markdownInteligente;
                console.log(`[VAULT_APPEND] Contenido formateado inteligentemente por LLM ✔️ [ ${((Date.now() - tStartLLM)/1000).toFixed(2)}s ]`);
                onProgress(`✅ Formato IA completado`);
            } catch (scrapeErr) {
                console.warn(`[VAULT_APPEND] Proceso falló (${scrapeErr.message}). Guardando solo el link. [ ${((Date.now() - tStartScrape)/1000).toFixed(2)}s ]`);
            }
        }

        // 1. Cargar el vault completo (incluyendo subcarpetas)
        const { VAULT_PATH_BOVEDA } = require('../config/env');
        const vaultFiles = leerVaultRecursivo(VAULT_PATH);
        console.log(`[TOOL vault_append] ${vaultFiles.length} notas cargadas del vault`);

        // 2. Resolver la nota destino
        const resultado = resolverNota(query, vaultFiles);

        if (!resultado) {
            // ── NUEVA LÓGICA: Categorización Inteligente para notas nuevas ──
            console.log(`[VAULT_APPEND] No hay match. Decidiendo categoría para nueva nota...`);
            onProgress(`Decidiendo ubicación óptima en la Bóveda...`);

            const promptCategoria = `Ronald quiere guardar esta información:
"${contenido.substring(0, 300)}"

Tu trabajo es decidir en qué carpeta de su Segundo Cerebro (Obsidian) debe ir.
Categorías comunes: Finanzas, Hardware, Proyectos, Personal, Ideas, Salud, Trabajo.
Si el tema no encaja en ninguna, propón una nueva de una sola palabra.

REGLA CRÍTICA: Responde ÚNICA Y EXCLUSIVAMENTE con la palabra exacta de la categoría. Cero explicaciones. Cero puntuación. No digas "La categoría es...". Solo la palabra.`;

            let categoria = 'Inbox';
            try {
                const sugerencia = await llamarOllama(promptCategoria, OLLAMA_MODEL_FAST);
                // Extraer solo la primera palabra alfabética (ignorar basura conversacional)
                const match = sugerencia.trim().match(/^[A-Za-zÁÉÍÓÚáéíóúÑñ]+/);
                if (match) {
                    categoria = match[0];
                } else {
                    console.warn(`[VAULT_APPEND] LLM devolvió formato inválido: "${sugerencia}". Usando Inbox.`);
                }
            } catch (err) {
                console.warn(`[VAULT_APPEND] Falló categorización LLM, usando Inbox.`);
            }

            let nombreArchivo = query;
            if (query.toLowerCase() === 'nueva_nota' || !query) {
                const tituloWeb = infoWeb && infoWeb.titulo ? infoWeb.titulo : '';
                if (tituloWeb) {
                    nombreArchivo = tituloWeb.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "").trim().substring(0, 50);
                } else {
                    nombreArchivo = `Nota_${Date.now()}`;
                }
            } else {
                nombreArchivo = nombreArchivo.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "");
            }

            // Forzar ruta dentro de BOVEDA/CATEGORIA
            const dirDestino = path.join(VAULT_PATH_BOVEDA, categoria);
            const nuevaRuta = path.join(dirDestino, `${nombreArchivo}.md`);
            
            console.log(`[TOOL vault_append] Creando nota nueva en: Boveda/${categoria}/${nombreArchivo}.md`);
            
            try {
                const textoNuevo = `---\ntipo: nota_nueva\ncreado: ${new Date().toISOString()}\ncategoria: ${categoria}\n---\n# ${nombreArchivo}\n\n${contenido}\n`;
                require('../repositories/vaultRepository').escribirArchivo(nuevaRuta, textoNuevo);
                return {
                    resumen: `No encontré donde guardarlo, así que creé una nueva categoría y nota: [[Boveda/${categoria}/${nombreArchivo}]].`,
                    datos: { exito: true, nota: nombreArchivo, path: `Boveda/${categoria}/`, accion: 'creada' }
                };
            } catch (err) {
                return {
                    resumen: `Error al crear la nota en la Bóveda: ${err.message}`,
                    datos: { exito: false }
                };
            }
        }

        // 3. Hacer append a la nota encontrada
        const rutaFinal = path.join(VAULT_PATH, resultado.nota.ruta);
        console.log(`[TOOL vault_append] Haciendo append en: ${rutaFinal} (score: ${resultado.score})`);

        try {
            const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const textoAAnadir = `\n\n---\n*Anotación (${timestamp}):*\n${contenido}\n`;
            appendArchivo(rutaFinal, textoAAnadir);

            return {
                resumen: `Listo. Se anotó la información en [[${resultado.nota.nombre}]] (coincidencia: ${resultado.score}%).`,
                datos: { exito: true, nota: resultado.nota.nombre, score: resultado.score }
            };
        } catch (error) {
            console.error(`[TOOL vault_append] Error al escribir:`, error.message);
            return {
                resumen: `Error del sistema al escribir en [[${resultado.nota.nombre}]]: ${error.message}`,
                datos: { exito: false, error: error.message }
            };
        }
    }
};

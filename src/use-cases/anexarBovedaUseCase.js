const path = require('path');
const { VAULT_PATH, leerVaultRecursivo, appendArchivo, escribirArchivo } = require('../repositories/vaultRepository');
const { extraerURL, scrapearURL } = require('../utils/urlScraper');
const { llamarOllama } = require('../adapters/ollamaAdapter');
const { OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP, VAULT_PATH_BOVEDA } = require('../config/env');
const { switchTo, liberarVRAM } = require('../services/vramManagerService');

// ══════════════════════════════════════════════════════════════════
// MOTOR DE RESOLUCIÓN INTELIGENTE
// ══════════════════════════════════════════════════════════════════

function extraerMetadatos(nota) {
    const meta = { nombre: nota.nombre.toLowerCase(), aliases: [], heading: '', wikilinks: [], tags: [] };
    const lines = nota.contenido.split('\n');
    let inFrontmatter = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '---') {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (inFrontmatter) {
            const match = trimmed.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, val] = match;
                const cleanVal = val.replace(/["\[\]]/g, '').trim().toLowerCase();
                if (['nombre', 'nombre_servidor', 'alias', 'titulo'].includes(key.toLowerCase())) {
                    meta.aliases.push(cleanVal);
                }
                if (key === 'tags') {
                    meta.tags = cleanVal.split(',').map(t => t.trim());
                }
            }
            continue;
        }

        if (!meta.heading && trimmed.startsWith('# ')) {
            meta.heading = trimmed.replace(/^#+\s*/, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim().toLowerCase();
        }

        const wikiMatches = trimmed.matchAll(/\[\[([^\]]+)\]\]/g);
        for (const wm of wikiMatches) {
            meta.wikilinks.push(wm[1].toLowerCase());
        }
    }
    return meta;
}

function calcularScore(query, nota, metadatos) {
    const q = query.toLowerCase().trim();
    const qWords = q.split(/\s+/).filter(w => w.length > 2);
    let score = 0;

    if (metadatos.nombre === q) return 100;
    if (metadatos.nombre.includes(q) || q.includes(metadatos.nombre)) score += 30;

    for (const alias of metadatos.aliases) {
        if (alias === q) return 95;
        if (alias.includes(q) || q.includes(alias)) score += 25;
    }

    if (metadatos.heading) {
        if (metadatos.heading === q) return 90;
        if (metadatos.heading.includes(q) || q.includes(metadatos.heading)) score += 20;
        for (const w of qWords) {
            if (metadatos.heading.includes(w)) score += 8;
        }
    }

    for (const wl of metadatos.wikilinks) {
        if (wl === q) score += 15;
        for (const w of qWords) {
            if (wl.includes(w)) score += 3;
        }
    }

    for (const tag of metadatos.tags) {
        for (const w of qWords) {
            if (tag.includes(w)) score += 5;
        }
    }

    const contenidoLower = nota.contenido.toLowerCase();
    for (const w of qWords) {
        const count = (contenidoLower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;
        score += Math.min(count * 2, 10);
    }
    return score;
}

function resolverNota(query, vaultFiles) {
    if (query.toLowerCase() === 'nueva_nota') return null;

    let mejorNota = null;
    let mejorScore = 0;

    for (const nota of vaultFiles) {
        const meta = extraerMetadatos(nota);
        const score = calcularScore(query, nota, meta);
        if (score > mejorScore) {
            mejorScore = score;
            mejorNota = nota;
        }
    }

    if (mejorNota && mejorScore >= 75) {
        return { nota: mejorNota, score: mejorScore };
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════
// CASO DE USO PRINCIPAL
// ══════════════════════════════════════════════════════════════════

async function anexarInformacionBoveda(query, contenidoInicial, onProgress) {
    let contenido = contenidoInicial;
    let infoWeb = null;

    // 1. Scraping Web Proactivo
    const urlDetectada = extraerURL(contenido);
    if (urlDetectada) {
        onProgress(`Scrapeando página web...`);
        try {
            infoWeb = await scrapearURL(urlDetectada);
            onProgress(`✅ Web scrapeada. Analizando contenido profundo...`);
            
            const promptFormateo = `El usuario Ronald quiere guardar una nota en Obsidian relacionada a la siguiente URL: ${urlDetectada}\n\nA continuación se presentan los datos crudos:\n- Título/Meta: ${infoWeb.titulo}\n- Contenido Extraído: ${infoWeb.contenido}\n\nPetición original:\n"${contenido}"\n\nInstrucciones:\n1. Resume especificaciones/precios.\n2. Usa Markdown.\n3. Añade wikilinks [[Concepto]].\n4. Solo el contenido final sin muletillas.\n\nRedacta la nota resultante ahora:`;

            await switchTo(OLLAMA_MODEL_DEEP);
            contenido = await llamarOllama(promptFormateo, OLLAMA_MODEL_DEEP);
            await liberarVRAM();
            onProgress(`✅ Formato IA completado`);
        } catch (err) {
            console.warn(`[USE_CASE] Error scraping: ${err.message}`);
        }
    }

    // 2. Búsqueda y Resolución
    const vaultFiles = leerVaultRecursivo(VAULT_PATH);
    const resultado = resolverNota(query, vaultFiles);

    // 3. Crear Nueva si no hay match
    if (!resultado) {
        onProgress(`Decidiendo ubicación óptima en la Bóveda...`);
        const promptCategoria = `Ronald quiere guardar esta información:\n"${contenido.substring(0, 300)}"\n\nDecide en qué categoría de Obsidian va. REGLA: Responde UNA sola palabra (ej: Finanzas, Hardware, Ideas).`;
        
        let categoria = 'Inbox';
        try {
            const sugerencia = await llamarOllama(promptCategoria, OLLAMA_MODEL_FAST);
            const match = sugerencia.trim().match(/^[A-Za-zÁÉÍÓÚáéíóúÑñ]+/);
            if (match) categoria = match[0];
        } catch (e) {
            console.warn('[USE_CASE] Categorización falló, usando Inbox');
        }

        let nombreArchivo = query;
        if (query.toLowerCase() === 'nueva_nota' || !query) {
            nombreArchivo = infoWeb?.titulo ? infoWeb.titulo.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "").trim().substring(0, 50) : `Nota_${Date.now()}`;
        } else {
            nombreArchivo = nombreArchivo.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "");
        }

        const dirDestino = path.join(VAULT_PATH_BOVEDA || VAULT_PATH, categoria);
        const nuevaRuta = path.join(dirDestino, `${nombreArchivo}.md`);
        
        const textoNuevo = `---\ntipo: nota_nueva\ncreado: ${new Date().toISOString()}\ncategoria: ${categoria}\n---\n# ${nombreArchivo}\n\n${contenido}\n`;
        escribirArchivo(nuevaRuta, textoNuevo);
        
        return {
            resumen: `No encontré donde guardarlo, así que creé una nueva categoría y nota: [[${categoria}/${nombreArchivo}]].`,
            datos: { exito: true, nota: nombreArchivo, path: `${categoria}/`, accion: 'creada' }
        };
    }

    // 4. Append si hubo match
    const rutaFinal = path.join(VAULT_PATH, resultado.nota.ruta);
    const timestamp = new Date().toISOString().split('T')[0];
    const textoAAnadir = `\n\n---\n*Anotación (${timestamp}):*\n${contenido}\n`;
    appendArchivo(rutaFinal, textoAAnadir);

    return {
        resumen: `Listo. Se anotó la información en [[${resultado.nota.nombre}]] (coincidencia: ${resultado.score}%).`,
        datos: { exito: true, nota: resultado.nota.nombre, score: resultado.score }
    };
}

module.exports = { anexarInformacionBoveda };

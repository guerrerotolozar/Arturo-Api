/**
 * src/utils/urlScraper.js — Scraper ligero para enriquecer URLs con contexto real.
 *
 * Cuando Ronald le pasa una URL a Arturo (ej: un link de una tarjeta gráfica),
 * este módulo entra a la página, extrae el título y el contenido principal,
 * y devuelve un resumen útil para guardar en la bóveda.
 *
 * Usa fetch nativo de Node 18+. Sin dependencias externas.
 */

/**
 * Detecta si un string contiene una URL válida.
 * @param {string} texto
 * @returns {string|null} - La primera URL encontrada, o null
 */
function extraerURL(texto) {
    const match = texto.match(/https?:\/\/[^\s\]\)\"',]+/i);
    return match ? match[0] : null;
}

/**
 * Raspa una URL y extrae título + contenido textual limpio.
 * @param {string} url
 * @returns {Promise<{titulo: string, contenido: string, url: string}>}
 */
async function scrapearURL(url) {
    console.log(`[SCRAPER] Leyendo: ${url}`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s max

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-CO,es;q=0.9'
            },
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Extraer <title>
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const titulo = titleMatch
            ? titleMatch[1].replace(/\s+/g, ' ').trim()
            : 'Sin título';

        // Extraer meta description
        const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        const metaDesc = descMatch ? descMatch[1].trim() : '';

        // Extraer precio si existe (e-commerce)
        const precioMatch = html.match(/\$[\d.,]+/);
        const precio = precioMatch ? precioMatch[0] : '';

        // Limpiar HTML → texto plano del body
        let bodyText = '';
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            bodyText = bodyMatch[1]
                .replace(/<script[\s\S]*?<\/script>/gi, '')  // Quitar scripts
                .replace(/<style[\s\S]*?<\/style>/gi, '')    // Quitar estilos
                .replace(/<nav[\s\S]*?<\/nav>/gi, '')        // Quitar navegación
                .replace(/<footer[\s\S]*?<\/footer>/gi, '')  // Quitar footer
                .replace(/<header[\s\S]*?<\/header>/gi, '')  // Quitar header
                .replace(/<[^>]+>/g, ' ')                    // Quitar todas las tags
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Tomar los primeros ~500 caracteres útiles del contenido
        const contenidoRecortado = bodyText.substring(0, 500).trim();

        const partes = [`**${titulo}**`];
        if (metaDesc) partes.push(metaDesc);
        if (precio) partes.push(`Precio detectado: ${precio}`);
        if (contenidoRecortado) partes.push(contenidoRecortado);

        const contenidoFinal = partes.join('\n');

        console.log(`[SCRAPER] OK → "${titulo}" (${contenidoFinal.length} chars)`);

        return { titulo, contenido: contenidoFinal, url };

    } catch (err) {
        console.warn(`[SCRAPER] Fallo al leer ${url}: ${err.message}`);
        return {
            titulo: 'No se pudo leer la página',
            contenido: `(Error al acceder: ${err.message})`,
            url
        };
    }
}

module.exports = { extraerURL, scrapearURL };

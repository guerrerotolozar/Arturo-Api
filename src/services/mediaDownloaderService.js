/**
 * src/services/mediaDownloaderService.js — Servicio de descarga multimedia.
 *
 * Descarga videos E IMÁGENES de redes sociales y los guarda
 * en la bóveda de Obsidian.
 *
 * Estrategia:
 *   - Videos → yt-dlp (YouTube, Instagram reels, TikTok, X, etc.)
 *   - Imágenes de Instagram → Scraping del embed público (sin auth)
 *   - Fallback inteligente: si yt-dlp falla con "No video formats",
 *     intenta extraer imágenes automáticamente.
 */

const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { YtDlp } = require('ytdlp-nodejs');
const { VAULT_PATH_BOVEDA, MEDIA_PATH, COOKIES_PATH } = require('../config/env');

// ── Configuración ──────────────────────────────────────────────────
const MEDIA_DIR    = MEDIA_PATH || path.join(VAULT_PATH_BOVEDA, 'Media');
const COOKIES_FILE = COOKIES_PATH || path.join(__dirname, '../../config/instagram_cookies.txt');
const USER_AGENT   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'; // UA básico para forzar HTML SSR en Instagram

// Asegurar que el directorio de medios exista
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    console.log(`[MEDIA_DOWNLOADER] Directorio de medios creado: ${MEDIA_DIR}`);
}

// Instancia singleton de YtDlp
const ytdlp = new YtDlp();

// Verificar cookies al arranque
if (fs.existsSync(COOKIES_FILE)) {
    console.log(`[MEDIA_DOWNLOADER] ✔️ Cookies disponibles: ${COOKIES_FILE}`);
} else {
    console.warn(`[MEDIA_DOWNLOADER] ⚠️ Sin cookies: ${COOKIES_FILE} — Instagram podría fallar.`);
}

// ════════════════════════════════════════════════════════════════════
// UTILIDADES HTTP (para descargas directas de imágenes)
// ════════════════════════════════════════════════════════════════════

function httpGet(url, headers = {}, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Demasiados redirects'));
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: { 'User-Agent': USER_AGENT, ...headers }
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                return resolve(httpGet(res.headers.location, headers, maxRedirects - 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout (15s)')); });
    });
}

function descargarArchivo(url, destino) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destino);
        const req = client.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                file.close();
                try { fs.unlinkSync(destino); } catch (_) {}
                return resolve(descargarArchivo(res.headers.location, destino));
            }
            if (res.statusCode !== 200) {
                file.close();
                try { fs.unlinkSync(destino); } catch (_) {}
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(destino); });
        });
        req.on('error', (err) => { file.close(); try { fs.unlinkSync(destino); } catch (_) {} reject(err); });
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout (60s)')); });
    });
}

// ════════════════════════════════════════════════════════════════════
// DESCARGA DE IMÁGENES DE INSTAGRAM
// ════════════════════════════════════════════════════════════════════

/**
 * Extrae el ID y tipo de una URL de Instagram.
 */
function analizarURLInstagram(url) {
    const match = url.match(/instagram\.com\/(?:reel|p|reels)\/([A-Za-z0-9_-]+)/);
    if (match) {
        const esReel = url.includes('/reel');
        return { esInstagram: true, id: match[1], tipo: esReel ? 'reel' : 'post' };
    }
    return { esInstagram: false };
}

/**
 * Descarga imágenes de un post de Instagram usando el endpoint embed + cookies.
 * Funciona con posts individuales y carruseles.
 */
async function descargarImagenesInstagram(postId, onProgress) {
    console.log(`[MEDIA_DOWNLOADER] 🖼️ Descargando imágenes de post: ${postId} con gallery-dl`);
    onProgress('Extrayendo imágenes del carrusel de Instagram...');

    const tieneCookies = fs.existsSync(COOKIES_FILE);
    const urlLimpia = `https://www.instagram.com/p/${postId}/`;
    
    // Configurar comando de gallery-dl (se necesita tener instalado gallery-dl en el servidor Linux)
    // Se usa un directorio temporal dentro de Media para no mezclar y luego se mueven
    const tempGalleryDir = path.join(MEDIA_DIR, `temp_gallery_${postId}`);
    let cmd = `gallery-dl "${urlLimpia}" -d "${tempGalleryDir}"`;
    
    if (tieneCookies) {
        cmd = `gallery-dl --cookies "${COOKIES_FILE}" "${urlLimpia}" -d "${tempGalleryDir}"`;
    }

    try {
        const { stdout, stderr } = await execPromise(cmd);
        
        // gallery-dl imprime las rutas de los archivos descargados una por línea
        // Si ya existen, imprime "# ruta/del/archivo"
        const lineas = stdout.split('\n')
                             .map(l => l.trim())
                             .filter(l => l)
                             .map(l => l.replace(/^#\s*/, '')); // Quitar el '#' si saltó la descarga
        
        if (lineas.length === 0) {
            return { exito: false, error: 'No se encontraron imágenes o la cuenta es privada y faltan cookies.' };
        }

        console.log(`[MEDIA_DOWNLOADER] 🖼️ ${lineas.length} imagen(es) encontrada(s) en el carrusel`);
        onProgress(`Procesando ${lineas.length} imagen(es)...`);

        const archivosDescargados = [];
        let index = 1;
        
        // Crear carpeta final para este post
        const finalDir = path.join(MEDIA_DIR, postId);
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }
        
        for (const rutaOriginal of lineas) {
            if (!fs.existsSync(rutaOriginal)) continue;
            
            const ext = path.extname(rutaOriginal);
            const nombreArchivo = lineas.length === 1 
                ? `${postId}${ext}` 
                : `${postId}_${index}${ext}`;
                
            const rutaDestino = path.join(finalDir, nombreArchivo);
            
            // Mover archivo a su carpeta final
            fs.renameSync(rutaOriginal, rutaDestino);
            archivosDescargados.push(nombreArchivo);
            
            console.log(`[MEDIA_DOWNLOADER] 🖼️ ✔️ ${postId}/${nombreArchivo}`);
            onProgress(`✅ Imagen ${index}/${lineas.length}: ${nombreArchivo}`);
            index++;
        }

        // Limpiar el directorio temporal (y vaciar los subdirectorios creados por gallery-dl)
        if (fs.existsSync(tempGalleryDir)) {
            fs.rmSync(tempGalleryDir, { recursive: true, force: true });
        }

        if (archivosDescargados.length === 0) {
             return { exito: false, error: 'Se descargaron archivos pero falló el procesamiento.' };
        }
        
        const resumen = archivosDescargados.length === 1
            ? archivosDescargados[0]
            : `${archivosDescargados.length} imágenes (${archivosDescargados.join(', ')})`;

        return {
            exito:   true,
            archivo: resumen,
            ruta:    path.join(finalDir, archivosDescargados[0]),
            titulo:  `Instagram Post ${postId}`,
            total:   archivosDescargados.length
        };

    } catch (err) {
        console.error(`[MEDIA_DOWNLOADER] 🖼️ ❌ Error gallery-dl:`, err.message);
        return { exito: false, error: `Fallo al descargar con gallery-dl. Ejecuta esto en tu servidor Linux: "sudo pip3 install gallery-dl" o "sudo apt install gallery-dl". Error: ${err.message}` };
    }
}

// ════════════════════════════════════════════════════════════════════
// ORQUESTADOR PRINCIPAL
// ════════════════════════════════════════════════════════════════════

/**
 * Descarga un video/audio/imagen desde una URL de red social.
 * Detecta la plataforma y tipo de contenido automáticamente.
 */
async function descargarMedia(url, onProgress = () => {}) {
    if (!url || typeof url !== 'string') {
        return { exito: false, error: 'URL inválida o vacía.' };
    }

    const urlLimpia = url.trim();
    console.log(`[MEDIA_DOWNLOADER] Iniciando descarga: ${urlLimpia}`);
    onProgress('Preparando descarga multimedia...');

    const tieneCookies = fs.existsSync(COOKIES_FILE);

    // ── Detectar Instagram post (imágenes) → descarga directa ───
    const ig = analizarURLInstagram(urlLimpia);
    if (ig.esInstagram && ig.tipo === 'post') {
        console.log(`[MEDIA_DOWNLOADER] 🖼️ Detectado Instagram post: ${ig.id}`);
        onProgress('Detectado post de Instagram. Extrayendo imágenes...');
        return await descargarImagenesInstagram(ig.id, onProgress);
    }

    // ── Todo lo demás → yt-dlp ──────────────────────────────────
    try {
        let titulo = 'video_sin_titulo';
        let info = null;
        try {
            const infoOpts = {};
            if (tieneCookies && ig.esInstagram) infoOpts.cookies = COOKIES_FILE;
            info = await ytdlp.getInfoAsync(urlLimpia, infoOpts);
            titulo = info.title || info.id || titulo;
            console.log(`[MEDIA_DOWNLOADER] Metadata: "${titulo}"`);
            onProgress(`Descargando: "${titulo}"...`);
        } catch (infoErr) {
            const msg = infoErr.message || '';
            console.warn(`[MEDIA_DOWNLOADER] Metadata no disponible: ${msg}. Continuando...`);

            // Si yt-dlp dice "No video formats" y es Instagram → intentar como imágenes
            if (msg.includes('No video formats') && ig.esInstagram) {
                console.log(`[MEDIA_DOWNLOADER] 🖼️ Fallback: intentando como imágenes...`);
                onProgress('No es video. Intentando como imágenes...');
                return await descargarImagenesInstagram(ig.id, onProgress);
            }
        }

        // Crear subcarpeta para el video usando el ID o un timestamp
        const idCarpeta = info && info.id ? info.id : `media_${Date.now()}`;
        const finalDir = path.join(MEDIA_DIR, idCarpeta);
        if (!fs.existsSync(finalDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
        }

        // Configurar y ejecutar descarga
        const builder = ytdlp
            .download(urlLimpia)
            .addArgs('-P', finalDir)
            .addArgs('-o', '%(id)s.%(ext)s')
            .addArgs('-f', 'bestvideo+bestaudio/best')
            .on('progress', (p) => {
                if (p.percentage_str) onProgress(`Descargando: ${p.percentage_str}`);
            });

        if (tieneCookies && ig.esInstagram) {
            builder.addArgs('--cookies', COOKIES_FILE);
            console.log(`[MEDIA_DOWNLOADER] Cookies inyectadas ✔️`);
        }

        const result = await builder.run();

        if (result.filePaths && result.filePaths.length > 0) {
            const archivoDescargado = result.filePaths[0];
            const nombreArchivo = path.basename(archivoDescargado);
            console.log(`[MEDIA_DOWNLOADER] ✔️ Descarga exitosa: ${idCarpeta}/${nombreArchivo}`);
            onProgress(`✅ Descarga completada: ${nombreArchivo}`);
            // Retornar la ruta relativa (carpeta/archivo) o absoluta, asegurándonos que coincida con lo esperado por Arturo
            return { exito: true, archivo: nombreArchivo, ruta: path.join(finalDir, nombreArchivo), titulo };
        }

        // Fallback: buscar archivo más reciente en Media
        const archivos = fs.readdirSync(MEDIA_DIR)
            .map(f => ({ nombre: f, mtime: fs.statSync(path.join(MEDIA_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

        if (archivos.length > 0) {
            const masReciente = archivos[0].nombre;
            return { exito: true, archivo: masReciente, ruta: path.join(MEDIA_DIR, masReciente), titulo };
        }

        return { exito: false, error: 'yt-dlp terminó sin errores pero no se encontró el archivo.' };

    } catch (err) {
        const mensajeError = err.message || String(err);
        console.error(`[MEDIA_DOWNLOADER] ❌ Error:`, mensajeError);

        // Si yt-dlp falla con "No video formats" y es Instagram → imágenes
        if (mensajeError.includes('No video formats') && ig.esInstagram) {
            console.log(`[MEDIA_DOWNLOADER] 🖼️ Fallback post-error: intentando como imágenes...`);
            return await descargarImagenesInstagram(ig.id, onProgress);
        }

        if (mensajeError.includes('login') || mensajeError.includes('cookie') || mensajeError.includes('403') || mensajeError.includes('empty media')) {
            return { exito: false, error: `Acceso denegado. Verifica cookies: ${COOKIES_FILE}. Error: ${mensajeError}` };
        }
        if (mensajeError.includes('not found') || mensajeError.includes('404')) {
            return { exito: false, error: `Contenido no encontrado o privado. Error: ${mensajeError}` };
        }
        return { exito: false, error: mensajeError };
    }
}

module.exports = { descargarMedia, MEDIA_DIR };

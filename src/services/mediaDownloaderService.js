/**
 * src/services/mediaDownloaderService.js — Servicio de descarga multimedia.
 *
 * Descarga videos de redes sociales usando yt-dlp y los guarda
 * en la bóveda de Obsidian. Soporta cookies para Instagram.
 *
 * Plataformas: YouTube, Instagram, TikTok, X/Twitter, Facebook, etc.
 */

const path = require('path');
const fs   = require('fs');
const { YtDlp } = require('ytdlp-nodejs');
const { VAULT_PATH_BOVEDA } = require('../config/env');

// ── Configuración ──────────────────────────────────────────────────
const MEDIA_DIR    = process.env.MEDIA_PATH || path.join(VAULT_PATH_BOVEDA, 'Media');
const COOKIES_FILE = process.env.COOKIES_PATH || path.join(__dirname, '../../config/instagram_cookies.txt');

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

/**
 * Descarga un video/audio desde una URL de red social.
 *
 * @param {string} url — URL del contenido (Instagram, YouTube, TikTok, X, etc.)
 * @param {(msg: string) => void} [onProgress] — Callback opcional de progreso
 * @returns {Promise<{ exito: boolean, archivo?: string, ruta?: string, titulo?: string, error?: string }>}
 */
async function descargarMedia(url, onProgress = () => {}) {
    if (!url || typeof url !== 'string') {
        return { exito: false, error: 'URL inválida o vacía.' };
    }

    const urlLimpia = url.trim();
    console.log(`[MEDIA_DOWNLOADER] Iniciando descarga: ${urlLimpia}`);
    onProgress('Preparando descarga multimedia...');

    const tieneCookies = fs.existsSync(COOKIES_FILE);

    try {
        // ── 1. Obtener metadata ─────────────────────────────────
        let titulo = 'video_sin_titulo';
        try {
            const infoOpts = {};
            if (tieneCookies) infoOpts.cookies = COOKIES_FILE;
            const info = await ytdlp.getInfoAsync(urlLimpia, infoOpts);
            titulo = info.title || info.id || titulo;
            console.log(`[MEDIA_DOWNLOADER] Metadata: "${titulo}"`);
            onProgress(`Descargando: "${titulo}"...`);
        } catch (infoErr) {
            console.warn(`[MEDIA_DOWNLOADER] Metadata no disponible: ${infoErr.message}. Continuando...`);
        }

        // ── 2. Configurar y ejecutar descarga ───────────────────
        // -P fuerza el DIRECTORIO, -o define el NOMBRE del archivo.
        const builder = ytdlp
            .download(urlLimpia)
            .addArgs('-P', MEDIA_DIR)
            .addArgs('-o', '%(id)s.%(ext)s')
            .addArgs('-f', 'bestvideo+bestaudio/best')
            .on('progress', (p) => {
                if (p.percentage_str) onProgress(`Descargando: ${p.percentage_str}`);
            });

        // Inyectar cookies si existen (crítico para Instagram)
        if (tieneCookies) {
            builder.addArgs('--cookies', COOKIES_FILE);
            console.log(`[MEDIA_DOWNLOADER] Cookies inyectadas ✔️`);
        }

        const result = await builder.run();

        // ── 3. Verificar resultado ──────────────────────────────
        if (result.filePaths && result.filePaths.length > 0) {
            const archivoDescargado = result.filePaths[0];
            const nombreArchivo = path.basename(archivoDescargado);
            console.log(`[MEDIA_DOWNLOADER] ✔️ Descarga exitosa: ${nombreArchivo}`);
            onProgress(`✅ Descarga completada: ${nombreArchivo}`);

            return {
                exito:   true,
                archivo: nombreArchivo,
                ruta:    path.join(MEDIA_DIR, nombreArchivo),
                titulo:  titulo
            };
        }

        // Fallback: buscar archivo más reciente en Media
        const archivos = fs.readdirSync(MEDIA_DIR)
            .map(f => ({ nombre: f, mtime: fs.statSync(path.join(MEDIA_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);

        if (archivos.length > 0) {
            const masReciente = archivos[0].nombre;
            console.log(`[MEDIA_DOWNLOADER] ✔️ Archivo detectado por timestamp: ${masReciente}`);
            return {
                exito:   true,
                archivo: masReciente,
                ruta:    path.join(MEDIA_DIR, masReciente),
                titulo:  titulo
            };
        }

        return { exito: false, error: 'yt-dlp terminó sin errores pero no se encontró el archivo.' };

    } catch (err) {
        const mensajeError = err.message || String(err);
        console.error(`[MEDIA_DOWNLOADER] ❌ Error:`, mensajeError);

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

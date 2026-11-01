/**
 * src/services/thumbnailService.js — Generador de thumbnails con ffmpeg.
 *
 * Extrae un frame representativo de cada video descargado para
 * mostrarlo en el Media Inbox de ArturoApp.
 *
 * Estrategia:
 *   - Videos: ffmpeg extrae el frame a los 2 segundos (evita pantallas negras de intro)
 *   - Imágenes: copia directa redimensionada a 480px de ancho
 *   - Fallback: si ffmpeg falla, se marca el thumb como null (la app muestra ícono genérico)
 *
 * Los thumbnails se guardan como .jpg junto al archivo original
 * con sufijo _thumb.jpg para fácil localización.
 */

const { exec } = require('child_process');
const util     = require('util');
const path     = require('path');
const fs       = require('fs');

const execPromise = util.promisify(exec);

// Extensiones de video reconocidas
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.m4v'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

/**
 * Genera un thumbnail para un archivo de media.
 * @param {string} filepath - Ruta absoluta al archivo de media.
 * @returns {Promise<{thumbPath: string|null, tipo: string}>}
 */
async function generarThumbnail(filepath) {
    if (!filepath || !fs.existsSync(filepath)) {
        console.warn(`[THUMB] Archivo no encontrado: ${filepath}`);
        return { thumbPath: null, tipo: 'video' };
    }

    const ext = path.extname(filepath).toLowerCase();
    const dir = path.dirname(filepath);
    const base = path.basename(filepath, ext);
    const thumbPath = path.join(dir, `${base}_thumb.jpg`);

    // Si ya existe el thumbnail, no regenerar
    if (fs.existsSync(thumbPath)) {
        const tipo = IMAGE_EXTENSIONS.includes(ext) ? 'imagen' : 'video';
        return { thumbPath, tipo };
    }

    try {
        if (IMAGE_EXTENSIONS.includes(ext)) {
            // Para imágenes: redimensionar a 480px de ancho manteniendo aspect ratio
            await execPromise(
                `ffmpeg -i "${filepath}" -frames:v 1 -update 1 -vf "scale=480:-1" -q:v 3 -y "${thumbPath}"`,
                { timeout: 15000 }
            );
            console.log(`[THUMB] Imagen thumb: ${path.basename(thumbPath)}`);
            return { thumbPath, tipo: 'imagen' };

        } else if (VIDEO_EXTENSIONS.includes(ext)) {
            // Para videos: extraer frame a los 2 segundos
            await execPromise(
                `ffmpeg -ss 2 -i "${filepath}" -frames:v 1 -update 1 -vf "scale=480:-1" -q:v 3 -y "${thumbPath}"`,
                { timeout: 30000 }
            );
            console.log(`[THUMB] Video thumb: ${path.basename(thumbPath)}`);
            return { thumbPath, tipo: 'video' };

        } else {
            console.log(`[THUMB] Extensión no soportada: ${ext}`);
            return { thumbPath: null, tipo: 'video' };
        }
    } catch (err) {
        console.warn(`[THUMB] ffmpeg falló para ${path.basename(filepath)}: ${err.message}`);
        // No es fatal — la app mostrará un ícono genérico
        return { thumbPath: null, tipo: VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'imagen' };
    }
}

/**
 * Obtiene la duración de un video en segundos usando ffprobe.
 * @param {string} filepath - Ruta absoluta al video.
 * @returns {Promise<number|null>} Duración en segundos, null si falla.
 */
async function obtenerDuracion(filepath) {
    try {
        const { stdout } = await execPromise(
            `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filepath}"`,
            { timeout: 10000 }
        );
        const duracion = parseFloat(stdout.trim());
        return isNaN(duracion) ? null : duracion;
    } catch {
        return null;
    }
}

module.exports = { generarThumbnail, obtenerDuracion };

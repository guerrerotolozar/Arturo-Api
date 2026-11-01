/**
 * src/utils/markdownSearcher.js
 *
 * Utilidad para buscar el archivo Markdown de resumen generado por mediaAnalysisService
 * basándose en el directorio y nombre del archivo de video.
 */
const fs = require('fs');
const path = require('path');

/**
 * Busca un archivo .md en el mismo directorio del video.
 * @param {string} videoPath - Ruta absoluta del video (ej: /.../20-05-2026_16-35-56.mp4)
 * @returns {string|null} Contenido del archivo .md si existe, null si no.
 */
function buscarResumenMarkdown(videoPath) {
    try {
        const dir = path.dirname(videoPath);
        const mdFile = fs.readdirSync(dir).find(f => f.endsWith('.md'));
        return mdFile ? fs.readFileSync(path.join(dir, mdFile), 'utf8') : null;
    } catch {
        return null;
    }
}

module.exports = { buscarResumenMarkdown };

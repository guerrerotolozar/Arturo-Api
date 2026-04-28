/**
 * src/tools/downloadMediaTool.js — Herramienta de descarga multimedia.
 *
 * Permite a Arturo descargar videos de redes sociales (Instagram, YouTube,
 * TikTok, X/Twitter, etc.) directamente a la bóveda de Obsidian.
 *
 * Contrato OCP: {nombre, descripcion, ejecutar} → se auto-registra en tools/index.js
 */

const { descargarMedia, MEDIA_DIR } = require('../services/mediaDownloaderService');

module.exports = {
    nombre: 'download_media',

    descripcion: 'Descarga videos o reels de redes sociales (Instagram, YouTube, TikTok, X/Twitter, Facebook, etc.) '
        + 'y los guarda en la bóveda de Obsidian. '
        + 'Usa esta herramienta cuando Ronald pida "descargar", "guardar", "bajar" o "salvar" un video o reel de un enlace/link/URL. '
        + 'Requiere el campo "url" con el enlace directo al contenido multimedia.',

    /**
     * @param {{ url: string }} params
     * @param {(msg: string) => void} [onProgress]
     * @returns {Promise<{ resumen: string, datos: object }>}
     */
    async ejecutar({ url } = {}, onProgress = () => {}) {
        if (!url) {
            return {
                resumen: 'Error: falta el campo "url". Necesito el enlace del video para descargarlo.',
                datos: { exito: false }
            };
        }

        console.log(`[TOOL download_media] URL recibida: "${url}"`);
        const resultado = await descargarMedia(url, onProgress);

        if (resultado.exito) {
            return {
                resumen: `✅ Video descargado exitosamente: "${resultado.titulo}". `
                    + `Archivo guardado como [[Media/${resultado.archivo}]] en la bóveda.`,
                datos: {
                    exito:   true,
                    archivo: resultado.archivo,
                    ruta:    resultado.ruta,
                    titulo:  resultado.titulo,
                    carpeta: MEDIA_DIR
                }
            };
        }

        return {
            resumen: `❌ No se pudo descargar el video. ${resultado.error}`,
            datos: { exito: false, error: resultado.error }
        };
    }
};

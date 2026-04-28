/**
 * src/controllers/download.js — Endpoint de descarga directa.
 *
 * Descarga multimedia sin pasar por el agente LLM.
 * Para uso desde el Share Target de la app Android.
 *
 * POST /IA/download  { "url": "https://..." }
 * → Llama a descargarMedia() directo → responde con el resultado.
 *
 * Tiempo: ~2-5s en vez de ~160s (sin plan ni síntesis LLM).
 */

const { descargarMedia } = require('../services/mediaDownloaderService');

async function downloadController(req, res) {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ exito: false, error: 'Falta el campo "url".' });
    }

    console.log(`[DOWNLOAD] 📥 Descarga directa: ${url}`);

    try {
        const resultado = await descargarMedia(url.trim());

        if (resultado.exito) {
            console.log(`[DOWNLOAD] ✔️ ${resultado.archivo}`);
        } else {
            console.warn(`[DOWNLOAD] ❌ ${resultado.error}`);
        }

        return res.json(resultado);
    } catch (err) {
        console.error(`[DOWNLOAD] ❌ Error fatal:`, err.message);
        return res.status(500).json({ exito: false, error: err.message });
    }
}

module.exports = downloadController;

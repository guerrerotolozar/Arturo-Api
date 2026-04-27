const fs = require('fs');
const path = require('path');
const { PROMPTS_PATH } = require('../config/env');

/**
 * Lee un archivo de prompt (.md) desde el Obsidian Vault.
 * Implementa "lazy loading" (lectura bajo demanda) para no saturar memoria.
 * 
 * @param {string} nombreArchivo - Nombre del archivo con extensión (ej: 'vision.md')
 * @param {string} fallback - Texto a devolver si el archivo no existe o hay error
 * @returns {string} - El contenido del prompt
 */
function obtenerPrompt(nombreArchivo, fallback = '') {
    if (!PROMPTS_PATH) {
        console.warn(`[PROMPT MANAGER] ⚠️ PROMPTS_PATH no configurado en .env. Usando fallback para ${nombreArchivo}.`);
        return fallback;
    }

    const rutaAbsoluta = path.join(PROMPTS_PATH, nombreArchivo);

    try {
        if (fs.existsSync(rutaAbsoluta)) {
            // Lectura sincrónica (archivos de texto pequeños no bloquean apreciablemente)
            return fs.readFileSync(rutaAbsoluta, 'utf-8').trim();
        } else {
            console.warn(`[PROMPT MANAGER] ⚠️ Archivo de prompt no encontrado: ${rutaAbsoluta}. Usando fallback.`);
            return fallback;
        }
    } catch (error) {
        console.error(`[PROMPT MANAGER] ❌ Error leyendo prompt ${nombreArchivo}:`, error.message);
        return fallback;
    }
}

module.exports = { obtenerPrompt };

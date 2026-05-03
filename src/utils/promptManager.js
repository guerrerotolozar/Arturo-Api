const fs = require('fs');
const path = require('path');
const { PROMPTS_PATH } = require('../config/env');

/**
 * Regex para detectar y eliminar frontmatter YAML de Obsidian.
 * Captura el bloque que empieza y termina con '---' al inicio del archivo.
 * Esto evita inyectar metadata de Obsidian (tipo, tags, creado) como tokens
 * al modelo, que los interpreta como parte de la instrucción.
 */
const FRONTMATTER_REGEX = /^---[\s\S]*?---\s*/;

/**
 * Lee un archivo de prompt (.md) desde el Obsidian Vault.
 * Implementa "lazy loading" (lectura bajo demanda) para no saturar memoria.
 * 
 * IMPORTANTE: Stripea automáticamente el frontmatter YAML de Obsidian.
 * Los prompts viven dentro de la Bóveda para editarlos fácilmente,
 * pero su metadata (tipo, tags, creado) NO es parte de la instrucción al LLM.
 * 
 * @param {string} nombreArchivo - Nombre del archivo con extensión (ej: 'vision.md')
 * @param {string} fallback - Texto a devolver si el archivo no existe o hay error
 * @returns {string} - El contenido del prompt (sin frontmatter)
 */
function obtenerPrompt(nombreArchivo, fallback = '') {
    if (!PROMPTS_PATH) {
        console.warn(`[PROMPT MANAGER] ⚠️ PROMPTS_PATH no configurado en .env. Usando fallback para ${nombreArchivo}.`);
        return fallback;
    }

    const rutaAbsoluta = path.join(PROMPTS_PATH, nombreArchivo);

    try {
        if (fs.existsSync(rutaAbsoluta)) {
            const raw = fs.readFileSync(rutaAbsoluta, 'utf-8');
            // Eliminar frontmatter YAML de Obsidian antes de enviar al LLM
            return raw.replace(FRONTMATTER_REGEX, '').trim();
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

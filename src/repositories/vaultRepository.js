/**
 * src/repositories/vaultRepository.js
 *
 * Única responsabilidad: leer y escribir archivos .md en el vault.
 * No sabe de vectores, grafos ni LLMs.
 */

const fs   = require('fs');
const path = require('path');
const { VAULT_PATH, PERFIL_RONALD } = require('../config/env');

function asegurarDirectorio(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Lee el archivo central de personalidad de Arturo.
 */

function leerNucleoArturo() {
    // Verificamos si la ruta existe en el .env y si el archivo físico está ahí
    if (PERFIL_RONALD && fs.existsSync(PERFIL_RONALD)) {
        return fs.readFileSync(PERFIL_RONALD, 'utf-8');
    }
    console.warn(`[REPO] No se encontró el perfil en: ${PERFIL_RONALD}`);
    return 'Eres Arturo, el asistente de Ronald. Tono técnico y directo.'; // Fallback de seguridad
}

/**
 * Lee recursivamente todos los .md del vault.
 * @param {string} dir
 * @returns {Array<{ruta, nombre, contenido}>}
 */
function leerVaultRecursivo(dir = VAULT_PATH) {
    const resultados = [];
    try {
        for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
            const ruta = path.join(dir, entrada.name);
            if (entrada.isDirectory()) {
                if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
                resultados.push(...leerVaultRecursivo(ruta));
            } else if (entrada.name.endsWith('.md')) {
                try {
                    resultados.push({
                        ruta:     ruta.replace(VAULT_PATH, ''),
                        nombre:   path.basename(ruta, '.md'),
                        contenido: fs.readFileSync(ruta, 'utf-8')
                    });
                } catch { /* archivo inaccesible — ignorar */ }
            }
        }
    } catch (err) {
        console.error(`[REPO] No se pudo leer ${dir}: ${err.message}`);
    }
    return resultados;
}

/**
 * Appends una entrada a un archivo. Lo crea si no existe.
 * @param {string} rutaAbsoluta
 * @param {string} contenido
 */
function appendArchivo(rutaAbsoluta, contenido) {
    asegurarDirectorio(path.dirname(rutaAbsoluta));
    fs.appendFileSync(rutaAbsoluta, contenido);
}

/**
 * Crea o sobreescribe un archivo con su contenido completo.
 * @param {string} rutaAbsoluta
 * @param {string} contenido
 */
function escribirArchivo(rutaAbsoluta, contenido) {
    asegurarDirectorio(path.dirname(rutaAbsoluta));
    fs.writeFileSync(rutaAbsoluta, contenido);
}

/**
 * Elimina un archivo.
 * @param {string} rutaAbsoluta
 */
function eliminarArchivo(rutaAbsoluta) {
    if (fs.existsSync(rutaAbsoluta)) fs.unlinkSync(rutaAbsoluta);
}

/**
 * Comprueba si un archivo existe.
 * @param {string} rutaAbsoluta
 * @returns {boolean}
 */
function existeArchivo(rutaAbsoluta) {
    return fs.existsSync(rutaAbsoluta);
}

/**
 * Lista archivos .md directamente en un directorio (no recursivo).
 * @param {string} dirRelativa - relativa al vault
 * @returns {string[]} nombres de archivo
 */
function listarArchivosDir(dirRelativa) {
    const dirAbs = path.join(VAULT_PATH, dirRelativa);
    if (!fs.existsSync(dirAbs)) return [];
    return fs.readdirSync(dirAbs).filter(f => f.endsWith('.md'));
}

module.exports = {
    VAULT_PATH,
    leerNucleoArturo,
    leerVaultRecursivo,
    appendArchivo,
    escribirArchivo,
    eliminarArchivo,
    existeArchivo,
    listarArchivosDir,
    asegurarDirectorio
};
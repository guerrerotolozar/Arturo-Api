/**
 * src/services/vaultService.js — Funciones de dominio del vault.
 *
 * LO QUE QUEDA AQUÍ son las dos funciones de escritura de dominio que
 * encapsulan reglas de negocio específicas del vault (frontmatter,
 * búsqueda recursiva de categoría, fallback a Inbox).
 * Usan vaultRepository en vez de fs directamente.
 */

const path = require('path');
const { VAULT_PATH }  = require('../config/env');
const {
    leerVaultRecursivo,
    appendArchivo,
    escribirArchivo,
    existeArchivo,
    asegurarDirectorio
} = require('../repositories/vaultRepository');

/**
 * Devuelve los nombres de todas las notas del vault.
 * @returns {string[]}
 */
function obtenerCategorias() {
    try {
        return leerVaultRecursivo().map(n => n.nombre);
    } catch { return []; }
}

/**
 * Appends una idea categorizada a su nota destino.
 * Si la nota no existe, la crea en /Inbox/ con frontmatter.
 *
 * @param {string} categoria
 * @param {string} idea
 * @param {string} timestamp
 * @param {string|null} rutaEspecifica
 */
function escribirIdeaEnVault(categoria, idea, timestamp, rutaEspecifica = null) {
    let destino;

    if (rutaEspecifica) {
        destino = path.join(VAULT_PATH, rutaEspecifica);
        asegurarDirectorio(path.dirname(destino));
    } else {
        const notaReal = leerVaultRecursivo().find(n => n.nombre.toLowerCase() === categoria.toLowerCase());

        if (notaReal) {
            destino = path.join(VAULT_PATH, notaReal.ruta);
        } else {
            const inboxDir = path.join(VAULT_PATH, 'Inbox');
            asegurarDirectorio(inboxDir);
            destino = path.join(inboxDir, `${categoria}.md`);

            if (!existeArchivo(destino)) {
                const fm = [
                    '---', `tipo: categoria_nueva`, `creado: ${timestamp}`,
                    `fuente: webhook_cerebro`, `revisado: false`,
                    '---', `# ${categoria}`, '',
                    '> Nota creada automaticamente por Arturo.', ''
                ].join('\n');
                escribirArchivo(destino, fm);
                console.log(`[VAULT] Nueva categoria: Inbox/${categoria}.md`);
            }
        }
    }

    appendArchivo(destino, `\n- [${timestamp}] ${idea}`);
    console.log(`[VAULT] Idea guardada en: ${destino.replace(VAULT_PATH, '')}`);
}

/**
 * Crea una nota .md completa con frontmatter.
 * Retorna { ruta, creada } — el use-case decide cómo reportarlo.
 */
function crearNotaEstructurada({ titulo, contenido, carpeta = 'Inbox', tipo = 'nota', timestamp }) {
    const nombreArchivo = titulo
        .replace(/[^a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1\u00fc\u00dc0-9\s_-]/g, '')
        .trim().replace(/\s+/g, '_');

    const destino = path.join(VAULT_PATH, carpeta, `${nombreArchivo}.md`);
    asegurarDirectorio(path.dirname(destino));

    if (existeArchivo(destino)) {
        console.warn(`[VAULT] "${nombreArchivo}.md" ya existe en ${carpeta}/. No se sobreescribio.`);
        return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: false };
    }

    const fm = ['---', `tipo: ${tipo}`, `creado: ${timestamp}`, `fuente: IA_nota`, '---', `# ${titulo}`, ''].join('\n');
    escribirArchivo(destino, fm + contenido);
    console.log(`[VAULT] Nota creada: ${carpeta}/${nombreArchivo}.md`);
    return { ruta: `${carpeta}/${nombreArchivo}.md`, creada: true };
}

module.exports = { obtenerCategorias, escribirIdeaEnVault, crearNotaEstructurada };
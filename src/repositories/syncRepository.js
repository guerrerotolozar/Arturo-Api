/**
 * src/repositories/syncRepository.js — Persistencia del estado de sincronización y Hash Cognitivo.
 *
 * Guarda la última fecha de modificación (mtimeMs) y el hash SHA-256 de la sustancia
 * (excluyendo bloques automáticos <!-- auto:begin --> y metadatos de máquina) de cada
 * archivo de la bóveda. Si un servicio interno solo inyecta backlinks o actualiza
 * metadatos de máquina, el hash de sustancia permanece idéntico y evita re-vectorizar
 * o disparar ciclos cognitivos redundantes.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database/arturo_memoria.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode
db.pragma('journal_mode = WAL');

// ══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN Y MIGRACIÓN NO DESTRUCTIVA
// ══════════════════════════════════════════════════════════════════

db.exec(`
    CREATE TABLE IF NOT EXISTS sync_estado (
        ruta          TEXT PRIMARY KEY,
        mtimeMs       INTEGER NOT NULL,
        hashSustancia TEXT DEFAULT '',
        ultima_sync   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
`);

try {
    db.exec(`ALTER TABLE sync_estado ADD COLUMN hashSustancia TEXT DEFAULT '';`);
} catch {
    // La columna ya existe
}

// ══════════════════════════════════════════════════════════════════
// OPERACIONES
// ══════════════════════════════════════════════════════════════════

/**
 * Obtiene el estado completo de la última sincronización.
 * @returns {Map<string, {mtimeMs: number, hashSustancia: string}>}
 */
function obtenerEstadoSync() {
    const filas = db.prepare('SELECT ruta, mtimeMs, hashSustancia FROM sync_estado').all();
    const estado = new Map();
    for (const fila of filas) {
        estado.set(fila.ruta, {
            mtimeMs: fila.mtimeMs,
            hashSustancia: fila.hashSustancia || ''
        });
    }
    return estado;
}

/**
 * Actualiza o inserta el estado de un archivo sincronizado con su Hash Cognitivo.
 * @param {string} ruta
 * @param {number} mtimeMs
 * @param {string} hashSustancia
 */
function upsertEstadoSync(ruta, mtimeMs, hashSustancia = '') {
    const stmt = db.prepare(`
        INSERT INTO sync_estado (ruta, mtimeMs, hashSustancia, ultima_sync) 
        VALUES (?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(ruta) DO UPDATE SET 
            mtimeMs = excluded.mtimeMs,
            hashSustancia = excluded.hashSustancia,
            ultima_sync = datetime('now', 'localtime')
    `);
    stmt.run(ruta, mtimeMs, hashSustancia);
}

/**
 * Elimina el registro de un archivo que ya no existe en la bóveda.
 * @param {string} ruta
 */
function eliminarEstadoSync(ruta) {
    db.prepare('DELETE FROM sync_estado WHERE ruta = ?').run(ruta);
}

/**
 * Limpia toda la tabla (para resets completos).
 */
function limpiarEstadoSync() {
    db.prepare('DELETE FROM sync_estado').run();
}

module.exports = {
    obtenerEstadoSync,
    upsertEstadoSync,
    eliminarEstadoSync,
    limpiarEstadoSync
};

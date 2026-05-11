/**
 * src/repositories/syncRepository.js — Persistencia del estado de sincronización.
 *
 * Guarda la última fecha de modificación (mtimeMs) de cada archivo de la bóveda
 * que ha sido sincronizado en la base vectorial. Esto permite RAG Incremental.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../arturo_memoria.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode
db.pragma('journal_mode = WAL');

// ══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════════════════════

db.exec(`
    CREATE TABLE IF NOT EXISTS sync_estado (
        ruta        TEXT PRIMARY KEY,
        mtimeMs     INTEGER NOT NULL,
        ultima_sync TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
`);



// ══════════════════════════════════════════════════════════════════
// OPERACIONES
// ══════════════════════════════════════════════════════════════════

/**
 * Obtiene el estado completo de la última sincronización.
 * @returns {Map<string, number>} Mapa de { ruta: mtimeMs }
 */
function obtenerEstadoSync() {
    const filas = db.prepare('SELECT ruta, mtimeMs FROM sync_estado').all();
    const estado = new Map();
    for (const fila of filas) {
        estado.set(fila.ruta, fila.mtimeMs);
    }
    return estado;
}

/**
 * Actualiza o inserta el estado de un archivo sincronizado.
 * @param {string} ruta 
 * @param {number} mtimeMs 
 */
function upsertEstadoSync(ruta, mtimeMs) {
    const stmt = db.prepare(`
        INSERT INTO sync_estado (ruta, mtimeMs, ultima_sync) 
        VALUES (?, ?, datetime('now', 'localtime'))
        ON CONFLICT(ruta) DO UPDATE SET 
            mtimeMs = excluded.mtimeMs,
            ultima_sync = datetime('now', 'localtime')
    `);
    stmt.run(ruta, mtimeMs);
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

/**
 * src/repositories/chatRepository.js — Persistencia de conversaciones.
 *
 * Usa better-sqlite3 (sincrónico, zero-config) para guardar los hilos
 * de conversación de Arturo. Cada chat tiene un ID único y una lista
 * de mensajes con rol (user/assistant) y timestamp.
 *
 * La BD se crea automáticamente al primer require() de este módulo.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../arturo_memoria.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode para mejor rendimiento en lecturas concurrentes
db.pragma('journal_mode = WAL');
// CRÍTICO: Sin esto, ON DELETE CASCADE no funciona en SQLite
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DE TABLAS
// ══════════════════════════════════════════════════════════════════

db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
        id          TEXT PRIMARY KEY,
        titulo      TEXT NOT NULL DEFAULT 'Nueva conversación',
        creado_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS mensajes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id     TEXT NOT NULL,
        rol         TEXT NOT NULL CHECK(rol IN ('user', 'assistant')),
        contenido   TEXT NOT NULL,
        fecha       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mensajes_chat ON mensajes(chat_id);
`);



// ══════════════════════════════════════════════════════════════════
// OPERACIONES CRUD
// ══════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo chat con un ID y título dados.
 */
function crearChat(id, titulo = 'Nueva conversación') {
    const stmt = db.prepare('INSERT OR IGNORE INTO chats (id, titulo) VALUES (?, ?)');
    stmt.run(id, titulo);
}

/**
 * Lista todos los chats, ordenados del más reciente al más antiguo.
 */
function listarChats() {
    return db.prepare('SELECT id, titulo, creado_at FROM chats ORDER BY creado_at DESC').all();
}

/**
 * Guarda un mensaje en un chat específico.
 * Si el chat no existe, lo crea automáticamente.
 * @param {string} chatId
 * @param {'user'|'assistant'} rol
 * @param {string} contenido
 */
function guardarMensaje(chatId, rol, contenido) {
    // Asegurar que el chat existe (idempotente por OR IGNORE)
    crearChat(chatId);
    const stmt = db.prepare('INSERT INTO mensajes (chat_id, rol, contenido) VALUES (?, ?, ?)');
    stmt.run(chatId, rol, contenido);
}

/**
 * Recupera los últimos N mensajes de un chat, ordenados cronológicamente.
 * @param {string} chatId
 * @param {number} limite - Cantidad máxima de mensajes (default: 10)
 * @returns {Array<{rol: string, contenido: string, fecha: string}>}
 */
function obtenerHistorial(chatId, limite = 10) {
    const stmt = db.prepare(`
        SELECT rol, contenido, fecha FROM mensajes
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
    `);
    // Se invierte porque los traemos DESC (los más recientes primero)
    return stmt.all(chatId, limite).reverse();
}

/**
 * Elimina un chat y todos sus mensajes (CASCADE).
 */
function eliminarChat(chatId) {
    db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
}

/**
 * Actualiza el título de un chat existente.
 */
function actualizarTitulo(chatId, nuevoTitulo) {
    db.prepare('UPDATE chats SET titulo = ? WHERE id = ?').run(nuevoTitulo, chatId);
}

module.exports = {
    crearChat,
    listarChats,
    guardarMensaje,
    obtenerHistorial,
    eliminarChat,
    actualizarTitulo
};

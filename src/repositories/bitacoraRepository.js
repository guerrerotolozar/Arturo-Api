/**
 * src/repositories/bitacoraRepository.js — Base de Datos Estructurada de Bitácora Operativa
 *
 * Reemplaza el volcado de logs en texto plano (.md) dentro de la Bóveda de Obsidian.
 * Almacena eventos operativos de proyectos satélite (ej. OasisStore, Bot-Trading, etc.)
 * en SQLite de alto rendimiento (better-sqlite3) con soporte completo para documentos JSON,
 * cero consumo de RAM en reposo y sin disparar indexaciones vectoriales en LanceDB.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database/arturo_bitacora.db');
const db = new Database(DB_PATH);

// WAL mode para alta concurrencia y lecturas ultra veloces
db.pragma('journal_mode = WAL');

// ============================================================
// INICIALIZACIÓN DE TABLA DE BITÁCORA
// ============================================================
db.exec(`
    CREATE TABLE IF NOT EXISTS bitacora_eventos (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        proyecto        TEXT NOT NULL DEFAULT 'OasisStore',
        evento          TEXT NOT NULL,
        titulo          TEXT,
        invoice_id      INTEGER,
        ticket_id       INTEGER,
        cliente_nombre  TEXT,
        cliente_email   TEXT,
        monto           TEXT,
        moneda          TEXT,
        detalles        TEXT,
        payload_json    TEXT NOT NULL,
        timestamp_origen TEXT,
        creado_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_bitacora_proyecto ON bitacora_eventos(proyecto);
    CREATE INDEX IF NOT EXISTS idx_bitacora_evento ON bitacora_eventos(evento);
    CREATE INDEX IF NOT EXISTS idx_bitacora_invoice ON bitacora_eventos(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_bitacora_ticket ON bitacora_eventos(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora_eventos(creado_at);
`);

/**
 * Inserta un nuevo evento operativo en la bitácora estructurada.
 */
function registrarEvento({
    proyecto = 'OasisStore',
    evento,
    titulo = null,
    invoice_id = null,
    ticket_id = null,
    cliente_nombre = null,
    cliente_email = null,
    monto = null,
    moneda = null,
    detalles = null,
    payload = {},
    timestamp = null,
}) {
    if (!evento) {
        throw new Error('El campo "evento" es obligatorio.');
    }

    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const ts = timestamp || new Date().toISOString();

    const stmt = db.prepare(`
        INSERT INTO bitacora_eventos (
            proyecto, evento, titulo, invoice_id, ticket_id,
            cliente_nombre, cliente_email, monto, moneda,
            detalles, payload_json, timestamp_origen
        ) VALUES (
            @proyecto, @evento, @titulo, @invoice_id, @ticket_id,
            @cliente_nombre, @cliente_email, @monto, @moneda,
            @detalles, @payload_json, @timestamp_origen
        )
    `);

    const info = stmt.run({
        proyecto,
        evento,
        titulo,
        invoice_id: invoice_id ? parseInt(invoice_id, 10) : null,
        ticket_id: ticket_id ? parseInt(ticket_id, 10) : null,
        cliente_nombre,
        cliente_email,
        monto: monto ? String(monto) : null,
        moneda,
        detalles,
        payload_json: payloadJson,
        timestamp_origen: ts,
    });

    return { id: info.lastInsertRowid, status: 'guardado' };
}

/**
 * Consulta eventos filtrables con paginación.
 */
function listarEventos({
    proyecto = null,
    evento = null,
    invoice_id = null,
    ticket_id = null,
    limite = 50,
    offset = 0,
} = {}) {
    let query = 'SELECT * FROM bitacora_eventos WHERE 1=1';
    const params = {};

    if (proyecto) {
        query += ' AND proyecto = @proyecto';
        params.proyecto = proyecto;
    }
    if (evento) {
        query += ' AND evento = @evento';
        params.evento = evento;
    }
    if (invoice_id) {
        query += ' AND invoice_id = @invoice_id';
        params.invoice_id = parseInt(invoice_id, 10);
    }
    if (ticket_id) {
        query += ' AND ticket_id = @ticket_id';
        params.ticket_id = parseInt(ticket_id, 10);
    }

    query += ' ORDER BY id DESC LIMIT @limite OFFSET @offset';
    params.limite = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
    params.offset = Math.max(parseInt(offset, 10) || 0, 0);

    const stmt = db.prepare(query);
    const rows = stmt.all(params);

    return rows.map(r => {
        try {
            r.payload = JSON.parse(r.payload_json);
        } catch {
            r.payload = r.payload_json;
        }
        delete r.payload_json;
        return r;
    });
}

/**
 * Estadísticas operativas rápidas por proyecto.
 */
function obtenerResumen(proyecto = 'OasisStore') {
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM bitacora_eventos WHERE proyecto = ?');
    const eventosStmt = db.prepare(`
        SELECT evento, COUNT(*) as cantidad 
        FROM bitacora_eventos 
        WHERE proyecto = ? 
        GROUP BY evento
    `);
    const ultimosStmt = db.prepare(`
        SELECT id, evento, titulo, creado_at 
        FROM bitacora_eventos 
        WHERE proyecto = ? 
        ORDER BY id DESC LIMIT 5
    `);

    return {
        proyecto,
        total_eventos: totalStmt.get(proyecto)?.total || 0,
        conteo_por_evento: eventosStmt.all(proyecto),
        ultimos_eventos: ultimosStmt.all(proyecto),
    };
}

module.exports = {
    registrarEvento,
    listarEventos,
    obtenerResumen,
};

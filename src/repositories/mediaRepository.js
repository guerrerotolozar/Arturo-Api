/**
 * src/repositories/mediaRepository.js — Persistencia de media descargada.
 *
 * Registra cada video/imagen descargado con su metadata para el
 * sistema de Media Intelligence. Los thumbnails se generan con
 * ffmpeg y se almacenan junto al archivo original.
 *
 * Tabla `media`:
 *   - id (autoincrement)
 *   - filename, filepath, thumb_path
 *   - titulo, fuente (tiktok, instagram, youtube, etc.)
 *   - url_origen
 *   - categoria (null hasta que Ronald la asigne)
 *   - sugerencia_ia (lo que Arturo sugiere, null hasta tener GPU)
 *   - tipo (video, imagen)
 *   - tamaño_bytes, duracion_seg
 *   - creado_at
 *
 * Usa la misma BD (arturo_memoria.db) que chatRepository.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database/arturo_memoria.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DE TABLA
// ══════════════════════════════════════════════════════════════════

db.exec(`
    CREATE TABLE IF NOT EXISTS media (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        filename        TEXT NOT NULL,
        filepath        TEXT NOT NULL,
        thumb_path      TEXT,
        titulo          TEXT DEFAULT 'Sin título',
        fuente          TEXT DEFAULT 'desconocida',
        url_origen      TEXT,
        categoria       TEXT,
        sugerencia_ia   TEXT,
        tipo            TEXT NOT NULL DEFAULT 'video' CHECK(tipo IN ('video', 'imagen')),
        tamano_bytes    INTEGER DEFAULT 0,
        duracion_seg    REAL,
        grupo_id        TEXT,
        creado_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_categoria ON media(categoria);
    CREATE INDEX IF NOT EXISTS idx_media_creado ON media(creado_at);
`);

// Migración: Asegurar que grupo_id existe en bases de datos existentes
try {
    db.exec(`ALTER TABLE media ADD COLUMN grupo_id TEXT`);
    console.log('[DATABASE] Columna "grupo_id" agregada exitosamente a la tabla "media".');
} catch (e) {
    // Si ya existe la columna, SQLite dará un error "duplicate column name: grupo_id"
    if (!e.message.includes('duplicate column name')) {
        console.warn('[DATABASE] Aviso en migración de "grupo_id":', e.message);
    }
}

// ══════════════════════════════════════════════════════════════════
// OPERACIONES CRUD
// ══════════════════════════════════════════════════════════════════

/**
 * Registra un archivo de media recién descargado.
 * @returns {number} ID del registro insertado.
 */
function registrarMedia({ filename, filepath, thumb_path, titulo, fuente, url_origen, tipo, tamano_bytes, duracion_seg, grupo_id, creado_at }) {
    if (creado_at) {
        const stmt = db.prepare(`
            INSERT INTO media (filename, filepath, thumb_path, titulo, fuente, url_origen, tipo, tamano_bytes, duracion_seg, grupo_id, creado_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(filename, filepath, thumb_path || null, titulo || 'Sin título', fuente || 'desconocida', url_origen || null, tipo || 'video', tamano_bytes || 0, duracion_seg || null, grupo_id || null, creado_at);
        return result.lastInsertRowid;
    } else {
        const stmt = db.prepare(`
            INSERT INTO media (filename, filepath, thumb_path, titulo, fuente, url_origen, tipo, tamano_bytes, duracion_seg, grupo_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(filename, filepath, thumb_path || null, titulo || 'Sin título', fuente || 'desconocida', url_origen || null, tipo || 'video', tamano_bytes || 0, duracion_seg || null, grupo_id || null);
        return result.lastInsertRowid;
    }
}

/**
 * Lista toda la media, ordenada de más reciente a más antigua.
 * Opcionalmente filtra por categoría o por estado (sin categorizar).
 */
function listarMedia({ categoria, sinCategorizar, limite } = {}) {
    let query = 'SELECT * FROM media';
    const params = [];

    if (sinCategorizar) {
        query += " WHERE categoria IS NULL OR categoria = '[]'";
    } else if (categoria) {
        query += ' WHERE EXISTS (SELECT 1 FROM json_each(categoria) WHERE value = ?)';
        params.push(categoria);
    }

    query += ' ORDER BY creado_at DESC';

    if (limite) {
        query += ' LIMIT ?';
        params.push(limite);
    }

    const rows = db.prepare(query).all(...params);

    // Agrupar items y parsear JSON
    const agrupados = [];
    const gruposMap = new Map();

    for (const row of rows) {
        if (row.categoria) {
            try { row.categorias = JSON.parse(row.categoria); } 
            catch (e) { row.categorias = [row.categoria]; }
        } else {
            row.categorias = [];
        }

        if (row.grupo_id) {
            if (!gruposMap.has(row.grupo_id)) {
                row.subItems = [];
                gruposMap.set(row.grupo_id, row);
                agrupados.push(row);
            } else {
                gruposMap.get(row.grupo_id).subItems.push(row);
            }
        } else {
            row.subItems = null;
            agrupados.push(row);
        }
    }

    return agrupados;
}

/**
 * Obtiene un registro de media por su ID.
 */
function obtenerMediaPorId(id) {
    return db.prepare('SELECT * FROM media WHERE id = ?').get(id);
}

/**
 * Asigna una categoría a un registro de media.
 * También guarda la sugerencia de la IA si se proporciona.
 */
function categorizarMedia(id, categoriasArray, sugerencia_ia = null) {
    const categoriaVal = (!categoriasArray || categoriasArray.length === 0) ? null : JSON.stringify(categoriasArray);
    const item = db.prepare('SELECT grupo_id FROM media WHERE id = ?').get(id);
    
    if (item && item.grupo_id) {
        if (sugerencia_ia) {
            db.prepare('UPDATE media SET categoria = ?, sugerencia_ia = ? WHERE grupo_id = ?').run(categoriaVal, sugerencia_ia, item.grupo_id);
        } else {
            db.prepare('UPDATE media SET categoria = ? WHERE grupo_id = ?').run(categoriaVal, item.grupo_id);
        }
    } else {
        if (sugerencia_ia) {
            db.prepare('UPDATE media SET categoria = ?, sugerencia_ia = ? WHERE id = ?').run(categoriaVal, sugerencia_ia, id);
        } else {
            db.prepare('UPDATE media SET categoria = ? WHERE id = ?').run(categoriaVal, id);
        }
    }
}

/**
 * Lista todas las categorías únicas descubiertas (no nulas).
 * Retorna un array de objetos { categoria, count }.
 */
function listarCategorias() {
    try {
        return db.prepare(`
            SELECT j.value as categoria, COUNT(DISTINCT IFNULL(media.grupo_id, media.id)) as count
            FROM media, json_each(media.categoria) j
            WHERE media.categoria IS NOT NULL AND media.categoria != '[]'
            GROUP BY j.value
            ORDER BY count DESC
        `).all();
    } catch(err) {
        // Fallback por si hay registros viejos que no son JSON
        return db.prepare(`
            SELECT categoria, COUNT(DISTINCT IFNULL(grupo_id, id)) as count
            FROM media
            WHERE categoria IS NOT NULL
            GROUP BY categoria
            ORDER BY count DESC
        `).all();
    }
}

/**
 * Elimina un registro de media por ID.
 */
function eliminarMedia(id) {
    db.prepare('DELETE FROM media WHERE id = ?').run(id);
}

/**
 * Cuenta la media sin categorizar.
 */
function contarSinCategorizar() {
    const row = db.prepare("SELECT COUNT(DISTINCT IFNULL(grupo_id, id)) as count FROM media WHERE categoria IS NULL OR categoria = '[]'").get();
    return row.count;
}

/**
 * Actualiza la ruta del thumbnail después de generarlo.
 */
function actualizarThumb(id, thumb_path) {
    db.prepare('UPDATE media SET thumb_path = ? WHERE id = ?').run(thumb_path, id);
}

/**
 * Actualiza el título y categoría cruda directamente en la BD (usado por Analysis Service).
 */
function actualizarTituloYInfo(id, titulo, categoriaJson) {
    db.prepare('UPDATE media SET titulo = ?, categoria = ? WHERE id = ?').run(titulo, categoriaJson, id);
}

module.exports = {
    registrarMedia,
    listarMedia,
    obtenerMediaPorId,
    categorizarMedia,
    listarCategorias,
    eliminarMedia,
    contarSinCategorizar,
    actualizarThumb,
    actualizarTituloYInfo
};

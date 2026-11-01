/**
 * src/controllers/media.js — Controladores para Media Intelligence.
 *
 * Endpoints:
 *   GET    /IA/media              → Lista media (filtrable por categoria, sin_categorizar)
 *   GET    /IA/media/categories   → Categorías descubiertas por Arturo
 *   GET    /IA/media/pending      → Conteo de media pendiente de categorización
 *   GET    /IA/media/:id          → Detalle de un item de media
 *   GET    /IA/media/:id/thumb    → Sirve la imagen del thumbnail
 *   GET    /IA/media/:id/file     → Sirve el archivo original (para adjuntar al chat)
 *   POST   /IA/media/:id/category → Asignar categoría (Arturo aprende aquí)
 *   DELETE /IA/media/:id          → Eliminar media
 */

const fs   = require('fs');
const path = require('path');
const mediaRepo = require('../repositories/mediaRepository');
const mayordomoService = require('../services/mayordomoService');

// ── Listar media ──────────────────────────────────────────────
function listarMediaController(req, res) {
    try {
        const { categoria, sin_categorizar, limite } = req.query;
        const items = mediaRepo.listarMedia({
            categoria:       categoria || null,
            sinCategorizar:  sin_categorizar === 'true',
            limite:          limite ? parseInt(limite) : null
        });

        return res.json({ media: items, total: items.length });
    } catch (err) {
        console.error('[MEDIA] Error listando media:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Categorías descubiertas ───────────────────────────────────
function listarCategoriasController(req, res) {
    try {
        const categorias = mediaRepo.listarCategorias();
        return res.json({ categorias });
    } catch (err) {
        console.error('[MEDIA] Error listando categorías:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Conteo de pendientes ──────────────────────────────────────
function contarPendientesController(req, res) {
    try {
        const count = mediaRepo.contarSinCategorizar();
        return res.json({ pendientes: count });
    } catch (err) {
        console.error('[MEDIA] Error contando pendientes:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Detalle de un item ────────────────────────────────────────
function obtenerMediaController(req, res) {
    try {
        const item = mediaRepo.obtenerMediaPorId(parseInt(req.params.id));
        if (!item) return res.status(404).json({ error: 'Media no encontrada.' });
        return res.json(item);
    } catch (err) {
        console.error('[MEDIA] Error obteniendo media:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Servir thumbnail ──────────────────────────────────────────
function servirThumbController(req, res) {
    try {
        const item = mediaRepo.obtenerMediaPorId(parseInt(req.params.id));
        if (!item) return res.status(404).json({ error: 'Media no encontrada.' });

        if (!item.thumb_path || !fs.existsSync(item.thumb_path)) {
            return res.status(404).json({ error: 'Thumbnail no disponible.' });
        }

        return res.sendFile(path.resolve(item.thumb_path));
    } catch (err) {
        console.error('[MEDIA] Error sirviendo thumbnail:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Servir archivo original ───────────────────────────────────
function servirArchivoController(req, res) {
    try {
        const item = mediaRepo.obtenerMediaPorId(parseInt(req.params.id));
        if (!item) return res.status(404).json({ error: 'Media no encontrada.' });

        if (!item.filepath || !fs.existsSync(item.filepath)) {
            return res.status(404).json({ error: 'Archivo no encontrado en disco.' });
        }

        return res.sendFile(path.resolve(item.filepath));
    } catch (err) {
        console.error('[MEDIA] Error sirviendo archivo:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Categorizar ───────────────────────────────────────────────
function categorizarController(req, res) {
    try {
        const { categorias } = req.body;
        if (!Array.isArray(categorias)) {
            return res.status(400).json({ error: 'Falta el campo "categorias" o no es un arreglo.' });
        }

        const id = parseInt(req.params.id);
        const item = mediaRepo.obtenerMediaPorId(id);
        if (!item) return res.status(404).json({ error: 'Media no encontrada.' });

        // Limpiamos strings vacíos y pasamos al repo
        const catsLimpias = categorias.map(c => c.trim()).filter(c => c);
        mediaRepo.categorizarMedia(id, catsLimpias);

        // 🧠 El Mayordomo aprende de esta acción manual
        mayordomoService.aprenderDeCategorizacion(catsLimpias);

        console.log(`[MEDIA] Categorizado: #${id} → [${catsLimpias.join(', ')}]`);
        return res.json({ mensaje: `Media #${id} categorizada` });
    } catch (err) {
        console.error('[MEDIA] Error categorizando:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// ── Eliminar ──────────────────────────────────────────────────
function eliminarMediaController(req, res) {
    try {
        const id = parseInt(req.params.id);
        const item = mediaRepo.obtenerMediaPorId(id);
        if (!item) return res.status(404).json({ error: 'Media no encontrada.' });

        // Eliminar archivos físicos del disco
        try {
            if (item.filepath && fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath);
            if (item.thumb_path && fs.existsSync(item.thumb_path)) fs.unlinkSync(item.thumb_path);

            // Intentar eliminar carpeta padre si quedó vacía
            const dir = path.dirname(item.filepath);
            if (fs.existsSync(dir)) {
                const remaining = fs.readdirSync(dir);
                if (remaining.length === 0) fs.rmdirSync(dir);
            }
        } catch (fsErr) {
            console.warn(`[MEDIA] Aviso limpiando archivos de #${id}:`, fsErr.message);
        }

        mediaRepo.eliminarMedia(id);
        console.log(`[MEDIA] Eliminado: #${id}`);
        return res.json({ mensaje: `Media #${id} eliminada.` });
    } catch (err) {
        console.error('[MEDIA] Error eliminando:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

function parseTimestamp(folderName) {
    const match = folderName.match(/^(\d{2})-(\d{2})-(\d{4})_(\d{2})-(\d{2})-(\d{2})$/);
    if (match) {
        const [, day, month, year, hour, minute, second] = match;
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    return null;
}

function detectFuente(name) {
    const u = name.toLowerCase();
    if (u.includes('tiktok')) return 'tiktok';
    if (u.includes('instagram') || u.length === 11 || u.startsWith('temp_gallery')) return 'instagram';
    if (u.includes('youtube') || u.includes('youtu')) return 'youtube';
    return 'desconocida';
}

function syncMediaController(req, res) {
    try {
        const { VAULT_PATH_BOVEDA, MEDIA_PATH } = require('../config/env');
        const MEDIA_DIR = MEDIA_PATH || path.join(VAULT_PATH_BOVEDA, 'Media');

        if (!fs.existsSync(MEDIA_DIR)) {
            return res.status(404).json({ error: 'Directorio de media no encontrado.' });
        }

        const subDirs = fs.readdirSync(MEDIA_DIR).filter(file => {
            const fullPath = path.join(MEDIA_DIR, file);
            return fs.statSync(fullPath).isDirectory();
        });

        // Obtener rutas ya registradas
        const allItems = mediaRepo.listarMedia();
        const registeredPaths = new Set();
        for (const item of allItems) {
            registeredPaths.add(item.filepath);
            if (item.subItems) {
                for (const sub of item.subItems) {
                    registeredPaths.add(sub.filepath);
                }
            }
        }

        let inserts = 0;

        for (const subDir of subDirs) {
            const subDirPath = path.join(MEDIA_DIR, subDir);
            const files = fs.readdirSync(subDirPath);

            const mediaFiles = [];
            let thumbFile = null;

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                const isThumb = file.includes('_thumb') || file.includes('thumb.jpg') || file.includes('thumb.png');
                
                if (isThumb) {
                    thumbFile = file;
                } else if (['.mp4', '.mov', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                    mediaFiles.push(file);
                }
            }

            if (mediaFiles.length === 0) continue;

            const grupoId = mediaFiles.length > 1 ? subDir : null;

            for (const mediaFile of mediaFiles) {
                const ext = path.extname(mediaFile).toLowerCase();
                const tipo = ['.mp4', '.mov', '.mkv', '.webm'].includes(ext) ? 'video' : 'imagen';
                const linuxFilePath = path.join(MEDIA_DIR, subDir, mediaFile).replace(/\\/g, '/');
                
                if (registeredPaths.has(linuxFilePath)) {
                    continue;
                }

                const winFilePath = path.join(subDirPath, mediaFile);
                const stats = fs.statSync(winFilePath);
                const linuxThumbPath = thumbFile ? path.join(MEDIA_DIR, subDir, thumbFile).replace(/\\/g, '/') : null;

                let creadoAt = parseTimestamp(subDir);
                if (!creadoAt) {
                    creadoAt = new Date(stats.mtimeMs).toISOString().replace('T', ' ').substring(0, 19);
                }

                const titulo = mediaFile.replace(ext, '').replace(/_/g, ' ');
                const fuente = detectFuente(subDir) || detectFuente(mediaFile);

                mediaRepo.registrarMedia({
                    filename: mediaFile,
                    filepath: linuxFilePath,
                    thumb_path: linuxThumbPath,
                    titulo,
                    fuente,
                    url_origen: null,
                    tipo,
                    tamano_bytes: stats.size,
                    duracion_seg: null,
                    grupo_id: grupoId,
                    creado_at: creadoAt
                });

                inserts++;
            }
        }

        console.log(`[MEDIA] Sincronización de disco completada: ${inserts} nuevos registros.`);
        return res.json({ mensaje: `Sincronización completada. ${inserts} nuevos archivos indexados.` });
    } catch (err) {
        console.error('[MEDIA] Error en sincronización de disco:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = {
    listarMediaController,
    listarCategoriasController,
    contarPendientesController,
    obtenerMediaController,
    servirThumbController,
    servirArchivoController,
    categorizarController,
    eliminarMediaController,
    syncMediaController
};

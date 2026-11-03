/**
 * src/controllers/bitacora.js — Endpoints REST para la Bitácora Operativa
 *
 * POST /api/bitacora       — Registrar un evento estructurado
 * GET  /api/bitacora       — Listar eventos con filtros y paginación
 * GET  /api/bitacora/stats — Resumen y métricas de eventos por proyecto
 */

const { registrarEvento, listarEventos, obtenerResumen } = require('../repositories/bitacoraRepository');

/**
 * POST /api/bitacora
 * Body: { proyecto, evento, titulo, invoice_id, ticket_id, cliente_nombre, cliente_email, monto, moneda, detalles, payload, timestamp }
 */
function registrarEventoController(req, res) {
    try {
        const {
            proyecto = 'OasisStore',
            evento,
            titulo,
            invoice_id,
            ticket_id,
            cliente_nombre,
            cliente_email,
            monto,
            moneda,
            detalles,
            payload,
            timestamp,
        } = req.body;

        if (!evento) {
            return res.status(400).json({ error: 'El campo "evento" es requerido.' });
        }

        const resultado = registrarEvento({
            proyecto,
            evento,
            titulo,
            invoice_id,
            ticket_id,
            cliente_nombre,
            cliente_email,
            monto,
            moneda,
            detalles,
            payload: payload || req.body,
            timestamp,
        });

        console.log(`[BITACORA] 📦 Registrado evento "${evento}" (${proyecto}) - ID #${resultado.id}`);
        return res.status(201).json({
            ok: true,
            mensaje: 'Evento registrado en base de datos estructurada.',
            id: resultado.id,
        });
    } catch (error) {
        console.error('[BITACORA] Error al registrar evento:', error);
        return res.status(500).json({ error: error.message });
    }
}

/**
 * GET /api/bitacora
 * Query params: ?proyecto=OasisStore&evento=...&invoice_id=...&ticket_id=...&limite=50&offset=0
 */
function listarEventosController(req, res) {
    try {
        const { proyecto, evento, invoice_id, ticket_id, limite, offset } = req.query;
        const eventos = listarEventos({
            proyecto,
            evento,
            invoice_id,
            ticket_id,
            limite,
            offset,
        });

        return res.json({
            ok: true,
            total_devueltos: eventos.length,
            eventos,
        });
    } catch (error) {
        console.error('[BITACORA] Error al listar eventos:', error);
        return res.status(500).json({ error: error.message });
    }
}

/**
 * GET /api/bitacora/stats
 * Query params: ?proyecto=OasisStore
 */
function statsBitacoraController(req, res) {
    try {
        const proyecto = req.query.proyecto || 'OasisStore';
        const stats = obtenerResumen(proyecto);
        return res.json({
            ok: true,
            stats,
        });
    } catch (error) {
        console.error('[BITACORA] Error al obtener estadísticas:', error);
        return res.status(500).json({ error: error.message });
    }
}

module.exports = {
    registrarEventoController,
    listarEventosController,
    statsBitacoraController,
};

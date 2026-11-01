/**
 * src/controllers/notificaciones.js — Notificaciones Push (Polling + SSE)
 * 
 * Permite que servicios externos (como el Bot de Trading) envíen
 * notificaciones que la app de Android recibe en tiempo real.
 * 
 * Canales:
 *   1. SSE (PRINCIPAL): GET /IA/notifications/stream → conexión persistente, entrega instantánea
 *   2. Polling (FALLBACK): GET /IA/notifications → la app pregunta cada X segundos
 * 
 * Flujo SSE:
 *   Bot Trading → POST /IA/notify → EventEmitter → SSE stream → App Android → Notificación nativa
 */

const { EventEmitter } = require('events');

// Bus de eventos para notificaciones en tiempo real
const notifBus = new EventEmitter();
notifBus.setMaxListeners(20); // Permitir múltiples clientes SSE

// ============================================================
// POST /IA/notify — Encolar + Broadcast SSE
// ============================================================

/**
 * POST /IA/notify
 * Body: { titulo: "...", mensaje: "...", tipo: "trading|sistema|info" }
 */
function enviarNotificacion(req, res) {
    const { titulo, mensaje, tipo = 'info' } = req.body;
    
    if (!titulo || !mensaje) {
        return res.status(400).json({ error: 'Faltan titulo y mensaje.' });
    }

    const notif = {
        id: Date.now(),
        titulo,
        mensaje,
        tipo,       // "trading", "sistema", "info"
        timestamp: new Date().toISOString(),
    };

    // Broadcast a todos los clientes SSE conectados (entrega instantánea)
    notifBus.emit('notificacion', notif);

    console.log(`[NOTIF] 📱 Nueva: "${titulo}" (tipo: ${tipo})`);
    res.status(201).json({ mensaje: 'Notificación encolada.', id: notif.id });
}

/**
 * Helper interno para enviar notificaciones desde otros servicios de la API (ej. Watchers).
 */
function enviarNotificacionLocal({ titulo, mensaje, tipo = 'info' }) {
    const notif = {
        id: Date.now(),
        titulo,
        mensaje,
        tipo,
        timestamp: new Date().toISOString(),
    };
    notifBus.emit('notificacion', notif);
    console.log(`[NOTIF] 📱 Local: "${titulo}" (tipo: ${tipo})`);
}

// ============================================================
// GET /IA/notifications/stream — SSE (Server-Sent Events)
// ============================================================

/**
 * GET /IA/notifications/stream
 * Conexión persistente. El servidor empuja notificaciones al cliente en tiempo real.
 * Heartbeat cada 25s para mantener la conexión viva a través de proxies/Tailscale.
 */
function streamNotificaciones(req, res) {
    // Headers SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Deshabilitar buffering en proxies (nginx, etc.)
    });

    // Confirmar conexión
    res.write(`data: ${JSON.stringify({ tipo: 'conectado', mensaje: 'SSE activo' })}\n\n`);

    // Listener: cuando llega una notificación, empujarla al cliente
    const onNotif = (notif) => {
        res.write(`data: ${JSON.stringify(notif)}\n\n`);
    };
    notifBus.on('notificacion', onNotif);

    // Heartbeat: mantener la conexión viva (invisible para el usuario)
    const heartbeat = setInterval(() => {
        res.write(': ping\n\n'); // Comentario SSE — el cliente lo ignora
    }, 25000);

    // Limpieza cuando el cliente se desconecta
    req.on('close', () => {
        notifBus.off('notificacion', onNotif);
        clearInterval(heartbeat);
    });
}

module.exports = { enviarNotificacion, streamNotificaciones, enviarNotificacionLocal };

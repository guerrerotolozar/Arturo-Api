/**
 * authGuard.js — Middleware de autenticación por API Key.
 *
 * ¿Por qué esto existe?
 * ──────────────────────
 * Ahora que Arturo está expuesto al internet vía Tailscale Funnel,
 * cualquier persona que adivine la URL podría hablarle.
 * Este middleware actúa como portero: si la petición no trae el
 * header `X-Arturo-Key` con la clave correcta, se rechaza con 401.
 *
 * Rutas exentas:
 *   - GET /status  → health-check público (para monitoreo)
 */

const { ARTURO_API_KEY } = require('../config/env');

function authGuard(req, res, next) {
    // Health-check siempre pasa (útil para uptime monitors)
    if (req.path === '/status' && req.method === 'GET') {
        return next();
    }

    // Si no hay API Key configurada, desactivar el guard (modo desarrollo)
    if (!ARTURO_API_KEY) {
        return next();
    }

    const clientKey = req.headers['x-arturo-key'];

    if (!clientKey || clientKey !== ARTURO_API_KEY) {
        const logEntry = `[${new Date().toISOString()}] ⛔ Bloqueado: ${req.ip} → ${req.method} ${req.path}\n`;
        
        // Guardar en archivo de seguridad en lugar de ensuciar la consola
        const fs = require('fs');
        const path = require('path');
        fs.appendFileSync(path.join(__dirname, '../../seguridad.log'), logEntry);

        return res.status(401).json({
            error: 'No autorizado',
            mensaje: 'Se requiere el header X-Arturo-Key con la clave correcta.'
        });
    }

    next();
}

module.exports = authGuard;

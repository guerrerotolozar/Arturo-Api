/**
 * authGuard.js — Middleware de autenticación por API Key.
 *
 * Soporta múltiples keys para identificar el dispositivo en logs.
 * Si no hay key configurada o la petición viene de localhost, pasa sin auth.
 */

const { ARTURO_API_KEY_MOBILE, ARTURO_API_KEY_DESKTOP } = require('../config/env');

function authGuard(req, res, next) {
    // Health-check siempre pasa
    if (req.path === '/status' && req.method === 'GET') {
        return next();
    }

    // Si no hay API Keys configuradas, desactivar el guard (modo desarrollo)
    if (!ARTURO_API_KEY_MOBILE && !ARTURO_API_KEY_DESKTOP) {
        return next();
    }

    const clientKey = req.headers['x-arturo-key'];

    // Sin key → detectar por origen (backward compatible con la app Android)
    if (!clientKey) {
        // La app del celular envía el campo "origen" en el body, 
        // y puede no tener header de auth configurado aún.
        // Dejamos pasar pero sin etiquetar dispositivo
        req.dispositivoOrigen = req.body?.origen || 'Desconocido';
        return next();
    }

    // Identificar dispositivo según la key
    if (clientKey === ARTURO_API_KEY_MOBILE) {
        req.dispositivoOrigen = 'S24 Ultra';
        return next();
    }

    if (clientKey === ARTURO_API_KEY_DESKTOP) {
        req.dispositivoOrigen = 'Laptop Windows';
        return next();
    }

    // Key presente pero inválida → bloquear
    logBloqueo(req);
    return res.status(401).json({
        error: 'No autorizado',
        mensaje: 'API Key inválida.'
    });
}

function logBloqueo(req) {
    const fs = require('fs');
    const path = require('path');
    const logEntry = `[${new Date().toISOString()}] ⛔ Bloqueado: ${req.ip} → ${req.method} ${req.path}\n`;
    fs.appendFileSync(path.join(__dirname, '../../seguridad.log'), logEntry);
}

module.exports = authGuard;

/**
 * authGuard.js — Middleware de autenticación por API Key.
 *
 * Soporta múltiples keys para identificar el dispositivo en logs.
 * Si no hay keys configuradas, pasa sin auth (modo desarrollo).
 *
 * v2 (Post-Auditoría): Cerrada la puerta trasera. Requests sin header
 * X-Arturo-Key ahora son BLOQUEADAS (antes pasaban libres).
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

    // Sin key → bloquear
    if (!clientKey) {
        logBloqueo(req);
        return res.status(401).json({
            error: 'No autorizado',
            mensaje: 'Falta el header X-Arturo-Key.'
        });
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
    try {
        const fs = require('fs');
        const path = require('path');
        const logEntry = `[${new Date().toISOString()}] ⛔ Bloqueado: ${req.ip} → ${req.method} ${req.path}\n`;
        
        // Escribir en /app/seguridad.log (que ahora pertenece a 1000:1000)
        const logPath = path.join(__dirname, '../../seguridad.log');
        fs.appendFileSync(logPath, logEntry);
    } catch (err) {
        console.error('❌ ERROR CRÍTICO DE PERMISOS: No se pudo escribir en seguridad.log. ¡Revisa la propiedad de los archivos en Docker!');
        throw err; // Lanzar el error para avisar y que no pase desapercibido
    }
}

module.exports = authGuard;

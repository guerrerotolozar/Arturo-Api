/**
 * requestLogger.js — Middleware de logging de peticiones.
 *
 * Registra:
 * - Timestamp
 * - Método HTTP
 * - Ruta
 * - IP
 * - API Key (si existe)
 * - Estado
 * - Duración
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_FILE = path.join(__dirname, '../../security.log');

function uuidv4() {
    return crypto.randomUUID();
}

function requestLogger(req, res, next) {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || uuidv4();

    const log = {
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        agent: req.headers['user-agent'] || 'unknown',
        'x-arturo-key': req.headers['x-arturo-key'] ? 'present' : 'absent',
        duration: null,
        status: null
    };

    // Log al inicio (siempre)
    const logEntry = `[${log.timestamp}] [${requestId}] ${log.method} ${log.path} | IP: ${log.ip} | Key: ${log['x-arturo-key']} | UA: ${log.agent}`;

    try {
        fs.appendFileSync(LOG_FILE, logEntry + '\n');
    } catch (err) {
        console.error('[REQUEST_LOGGER] Error escribiendo log:', err.message);
    }

    // Log al terminar (siempre)
    res.on('finish', () => {
        log.duration = Date.now() - start;
        log.status = res.statusCode;
        const finalEntry = `[${log.timestamp}] [${requestId}] ${log.method} ${log.path} | Status: ${log.status} | Duration: ${log.duration}ms`;

        try {
            fs.appendFileSync(LOG_FILE, finalEntry + '\n');
        } catch (err) {
            console.error('[REQUEST_LOGGER] Error escribiendo log final:', err.message);
        }
    });

    next();
}

module.exports = requestLogger;

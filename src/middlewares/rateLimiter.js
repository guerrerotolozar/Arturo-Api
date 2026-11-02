/**
 * rateLimiter.js — Middleware de protección contra abusos.
 *
 * Implementa rate limiting por API Key (o por IP si no hay key).
 * Protege contra:
 * - DoS por volumen de peticiones
 * - Scraping automatizado
 * - Agotamiento de recursos (GPU, VRAM)
 */

// Sin dependencias externas — implementación nativa con Map

// Configuración
const RATE_LIMITS = {
    // Peticiones normales
    normal: { windowMs: 60000, max: 60 }, // 60 req/min
    // Agentes de IA (pueden ser más pesados)
    agent: { windowMs: 60000, max: 30 }, // 30 req/min
    // Sincronización (poco frecuente)
    sync: { windowMs: 3600000, max: 10 }, // 10 req/hora
    // Notificaciones (tiempo real)
    notifications: { windowMs: 60000, max: 20 } // 20 req/min
};

// Patrones de IPs sospechosas (WordPress scanning, etc.)
const SUSPICIOUS_PATTERNS = [
    'wp-includes',
    'wp-config',
    'xmlrpc',
    'phpinfo',
    'server-status',
    'server-info',
    '.env',
    '.git',
    'appsettings',
    'config.php'
];

// Contador in-memory: { [requestId]: { count: N, windowStart: timestamp } }
const counters = new Map();

/**
 * Verifica si una IP está en la lista negra
 */
function isIpBlocked(ip) {
    // Aquí puedes agregar IPs bloqueadas manualmente
    return false;
}

/**
 * Limpia contadores expirados cada 30 segundos
 */
setInterval(() => {
    const now = Date.now();
    for (const [id, data] of counters.entries()) {
        if (now - data.windowStart > data.windowMs * 2) {
            counters.delete(id);
        }
    }
}, 30000);

/**
 * Middleware de Rate Limiting
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Next de Express
 */
function rateLimiter(req, res, next) {
    try {
        // Eximir endpoint de healthcheck / status para no degradar el contenedor en Docker
        if (req.path === '/status') {
            return next();
        }

        // Verificar si la IP está bloqueada
        const ip = req.ip;
        if (isIpBlocked(ip)) {
            return res.status(403).json({
                error: 'IP bloqueada',
                mensaje: 'Tu IP ha sido bloqueada temporalmente.'
            });
        }

        // Identificar el tipo de petición
        const requestType = classifyRequest(req);
        const limitConfig = RATE_LIMITS[requestType] || RATE_LIMITS.normal;

        // Identificador único por petición
        const requestId = req.headers['x-arturo-key'] || ip;

        // Limpiar contador si expiró la ventana o inicializar
        const now = Date.now();
        let data = counters.get(requestId);
        if (data && (now - data.windowStart > limitConfig.windowMs)) {
            counters.delete(requestId);
            data = null;
        }

        if (!data) {
            data = { count: 1, windowStart: now };
            counters.set(requestId, data);
        } else {
            data.count += 1;
        }

        const currentCount = data.count;

        if (currentCount > limitConfig.max) {
            const resetTime = Math.ceil((limitConfig.windowMs - (now % limitConfig.windowMs)) / 1000);
            return res.status(429).json({
                error: 'Rate Limit Excedido',
                mensaje: `Máximo ${limitConfig.max} peticiones por ${limitConfig.windowMs / 1000} segundos. Intenta de nuevo en ${resetTime} segundos.`,
                retryAfter: resetTime,
                tipo: requestType
            });
        }

        next();
    } catch (err) {
        console.error('[RATE_LIMITER] Error:', err);
        next(); // No romper el flujo por errores de rate limiting
    }
}

/**
 * Clasifica el tipo de petición para aplicar el límite correcto
 */
function classifyRequest(req) {
    const path = req.path;

    if (path === '/api/notifications/stream') {
        return 'notifications';
    }
    if (path.includes('/api/vectores') || path.includes('/sync')) {
        return 'sync';
    }
    if (path === '/api/agent/chat' || path === '/api/bot/inference') {
        return 'agent';
    }
    return 'normal';
}

module.exports = { rateLimiter, RATE_LIMITS };

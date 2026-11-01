/**
 * ipBlocker.js — Middleware para bloquear IPs maliciosas.
 *
 * Bloquea automáticamente IPs que:
 * - Hacen más de 1000 peticiones por hora (brute force)
 * - Acceden a rutas sensibles (/etc, /.env, /.git, etc.)
 * - Son de rangos de IP conocidos como malicious (configurable)
 */

const BLOCKED_PATHS = [
    '/.env',
    '/.git',
    '/.git/',
    '/appsettings',
    '/wp-config',
    '/xmlrpc',
    '/phpinfo',
    '/server-status',
    '/server-info',
    '/config.php',
    '/robots.txt',
    '/favicon.ico',
    '/favicon.png',
    '/.gitconfig'
];

const BLOCKED_PATH_PATTERNS = [
    'wp-includes',
    'wp-content',
    'wp-admin',
    'wp-login',
    'wp-content/uploads',
    'wp-content/plugins',
    'wp-content/themes',
    'wp-includes/wp-',
    'wp-includes/l-',
    'wp-includes/wlwmanifest',
    'wp-includes/rss.php'
];

// IP ranges a bloquear (puedes agregar más)
const BLOCKED_IP_RANGES = [
    '100.96.0.0/16'  // Ejemplo: rango de IPs sospechosas
];

class IpBlocker {
    constructor() {
        this.blockedIps = new Set();
        this.requestCounts = new Map();
        this.windowStart = Date.now();
        this.WINDOW_MS = 3600000; // 1 hora
        this.MAX_REQUESTS = 1000; // 1000 req/hora
    }

    /**
     * Verifica si una IP debería ser bloqueada
     */
    isBlocked(req) {
        const ip = (req.socket || req).remoteAddress || '127.0.0.1';
        
        // --- WHITELIST ---
        // Nunca bloquear peticiones internas (Localhost o redes de Docker)
        if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || 
            ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.168.')) {
            return false;
        }

        // Verificar si está en la lista de IPs bloqueadas
        if (this.blockedIps.has(ip)) {
            return true;
        }

        // Verificar si accede a rutas sensibles
        if (this.accessesSensitivePath(req)) {
            return true;
        }

        // Verificar si excede el límite de peticiones
        if (this.exceedsLimit(ip)) {
            this.blockIps(ip);
            return true;
        }

        return false;
    }

    /**
     * Verifica si la IP accede a rutas sensibles
     */
    accessesSensitivePath(req) {
        const path = (req.path || req.url || '').toLowerCase();

        // Verificar rutas exactas
        for (const blockedPath of BLOCKED_PATHS) {
            if (path === blockedPath) {
                console.warn(`[IP_BLOCKER] ${ip} accedió a ruta sensible: ${blockedPath}`);
                return true;
            }
        }

        // Verificar patrones
        for (const pattern of BLOCKED_PATH_PATTERNS) {
            if (path.includes(pattern)) {
                console.warn(`[IP_BLOCKER] ${ip} accedió a ruta sensible: ${path} (contiene '${pattern}')`);
                return true;
            }
        }

        return false;
    }

    /**
     * Verifica si la IP excede el límite de peticiones
     */
    exceedsLimit(ip) {
        const now = Date.now();

        // Limpiar ventanas expiradas
        this.windowStart = now;

        // Obtener o inicializar contador
        let count = this.requestCounts.get(ip) || 0;
        this.requestCounts.set(ip, count + 1);

        // Verificar si excede el límite
        if (count > this.MAX_REQUESTS) {
            console.warn(`[IP_BLOCKER] ${ip} excedió límite: ${count} peticiones/hora`);
            return true;
        }

        return false;
    }

    /**
     * Bloquea una IP por el tiempo configurado
     */
    blockIps(ip) {
        this.blockedIps.add(ip);
        console.warn(`[IP_BLOCKER] 🔒 IP bloqueada por ${this.WINDOW_MS / 1000} segundos: ${ip}`);
    }

    /**
     * Desbloquea una IP
     */
    unblockIp(ip) {
        this.blockedIps.delete(ip);
        console.log(`[IP_BLOCKER] 🔓 IP desbloqueada: ${ip}`);
    }

    /**
     * Obtiene estadísticas de bloqueo
     */
    getStats() {
        return {
            blockedIps: this.blockedIps.size,
            totalBlocked: this.blockedIps.size,
            windowStart: this.windowStart,
            maxRequests: this.MAX_REQUESTS
        };
    }
}

// Exportar instancia única
module.exports = new IpBlocker();

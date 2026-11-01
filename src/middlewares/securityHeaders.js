/**
 * securityHeaders.js — Middleware de seguridad HTTP.
 *
 * Añade headers de seguridad para proteger contra:
 * - Clickjacking
 * - MIME sniffing
 * - XSS
 * - Content type sniffing
 */

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
}

module.exports = securityHeaders;

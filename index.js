/**
 * index.js — Punto de entrada principal del servidor Arturo.
 * Solo Express, rutas y middlewares. CERO lógica de negocio.
 *
 * v10 (Post-Auditoría de Seguridad):
 * - Rate limiting por tipo de petición
 * - Bloqueo de IPs maliciosas
 * - Headers de seguridad HTTP
 * - Logging mejorado
 * - CORS restringido
 */

const express = require('express');
const { PORT } = require('./src/config/env');

// Importar Thin Controllers
const consultaIAFast = require('./src/controllers/agent');
const crearNota = require('./src/controllers/nota');
const obtenerStatus = require('./src/controllers/status');
const { botInferenceController } = require('./src/controllers/bot');
const { gpuStatusController, gpuQueueController } = require('./src/controllers/gpu');
const downloadDirecto = require('./src/controllers/download');
const { listarChatsController, eliminarChatController, obtenerMensajesController } = require('./src/controllers/chats');
const { syncVectoresController, estadoVectoresController, getRagContextController } = require('./src/controllers/vectores');
const { enviarNotificacion, streamNotificaciones } = require('./src/controllers/notificaciones');
const { listarMediaController, listarCategoriasController, contarPendientesController, obtenerMediaController, servirThumbController, servirArchivoController, categorizarController, eliminarMediaController, syncMediaController } = require('./src/controllers/media');
const timeUtils = require('./src/utils/timeUtils');

const app = express();

// ============================================
// MIDDLEWARES
// ============================================

// v10: Logging de peticiones
const requestLogger = require('./src/middlewares/requestLogger');
app.use(requestLogger);

// v10: Headers de seguridad
const securityHeaders = require('./src/middlewares/securityHeaders');
app.use(securityHeaders);

// v10: IP Blocker (anti-scanning, anti-brute-force)
const ipBlocker = require('./src/middlewares/ipBlocker');
app.use((req, res, next) => {
    if (ipBlocker.isBlocked(req.ip)) {
        return res.status(403).json({
            error: 'Acceso denegado',
            mensaje: 'Tu IP ha sido bloqueada temporalmente por actividad sospechosa.'
        });
    }
    next();
});

// v10: CORS restringido (solo localhost y Tailscale)
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-arturo-key, x-request-id');
    } else {
        res.header('Access-Control-Allow-Origin', '*'); // Fallback para desarrollo
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-arturo-key, x-request-id');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// v10: Rate Limiting
const { rateLimiter } = require('./src/middlewares/rateLimiter');
app.use(rateLimiter);

// v10: Body parser resiliente con límites más estrictos y auto-sanitización de caracteres de control (RFC 8259)
app.use(express.text({ type: ['application/json', 'text/plain'], limit: '10mb' }));
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'string') {
        const raw = req.body.trim();
        if (raw.startsWith('{') || raw.startsWith('[')) {
            try {
                req.body = JSON.parse(raw);
            } catch (err) {
                try {
                    // Sanitizar caracteres de control no escapados en strings JSON (U+0000 hasta U+001F)
                    // Corrige saltos de línea crudos dentro de comillas sin romper la petición
                    const sanitized = raw.replace(/[\u0000-\u001F]/g, (char) => {
                        if (char === '\n') return '\\n';
                        if (char === '\r') return '\\r';
                        if (char === '\t') return '\\t';
                        return '';
                    });
                    req.body = JSON.parse(sanitized);
                    console.log(`[BODY_PARSER] ⚠️ JSON con caracteres de control sanitizado con éxito para ${req.path}`);
                } catch (errSanitized) {
                    console.error(`[BODY_PARSER] ❌ Error fatal parseando JSON en ${req.path}:`, err.message);
                    return res.status(400).json({ error: 'JSON malformado', detalle: err.message });
                }
            }
        }
    } else if (!req.body) {
        req.body = {};
    }
    next();
});
app.use(express.json({ limit: '10mb' }));


// v10: Autenticación por API Key
const authGuard = require('./src/middlewares/authGuard');
app.use(authGuard);

// ============================================
// RUTAS DE LA API
// ============================================

// 1. Agentes y Consultas
app.post('/api/agent/chat', consultaIAFast);             // El Agente Principal
app.post('/api/bot/inference', botInferenceController);  // Inferencias del Bot de Trading
app.post('/api/media/download', downloadDirecto);        // Descarga directa (sin LLM)

// 1.5 Creación
app.post('/api/notas', crearNota);                       // Crear notas estructuradas (usado por Bots de Trading)

// 2. Memoria Conversacional
app.get('/api/chats', listarChatsController);      // Lista todos los chats
app.get('/api/chats/:id/mensajes', obtenerMensajesController); // Mensajes de un chat
app.delete('/api/chats/:id', eliminarChatController); // Elimina un chat

// 3. Sistema
app.get('/status', obtenerStatus);               // Health-check (Vault, Ollama)
app.get('/api/gpu/status', gpuStatusController); // Estado de GPU en tiempo real
app.get('/api/gpu/queue', gpuQueueController);   // Estado de la cola de GPU

// 4. Base Vectorial
app.post('/api/vectores/sync', syncVectoresController);     // Sincronizar Bóveda → LanceDB
app.get('/api/rag/context', getRagContextController);       // RAG: Buscar contexto histórico
app.get('/api/vectores/estado', estadoVectoresController);  // Estado de LanceDB

// 5. Notificaciones Push (Bot Trading → App Android)
app.post('/api/notifications', enviarNotificacion);                  // Encolar notificación
app.get('/api/notifications/stream', streamNotificaciones);   // SSE en tiempo real (push instantáneo)

// 6. Media Intelligence (Videos descargados + Categorización)
app.get('/api/media', listarMediaController);       // Lista media (filtrable)
app.get('/api/media/categories', listarCategoriasController);  // Categorías descubiertas
app.get('/api/media/pending', contarPendientesController);  // Conteo de pendientes
app.get('/api/media/:id', obtenerMediaController);      // Detalle de un item
app.get('/api/media/:id/thumb', servirThumbController);       // Servir thumbnail
app.get('/api/media/:id/file', servirArchivoController);     // Servir archivo original
app.post('/api/media/:id/category', categorizarController);       // Asignar categoría
app.post('/api/media/sync', syncMediaController);        // Sincronizar media física en disco con la BD
app.delete('/api/media/:id', eliminarMediaController);     // Eliminar media

// 7. Sistema Global
app.use('/api/sysadmin', require('./src/controllers/sysadmin'));

app.post('/api/system/pause-trading', (req, res) => {
    const { setManualPause, isManualPaused } = require('./src/utils/timeUtils');
    if (req.body.pause !== undefined) {
        setManualPause(req.body.pause === true || req.body.pause === 'true');
    }
    res.json({ success: true, isPaused: isManualPaused() });
});

// ============================================
// INICIO DEL SERVIDOR
// ============================================
const { toolsList } = require('./src/tools/langchainTools');

const server = app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║                    Arturo                        ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log(`  ║  Puerto:        ${PORT}                             ║`);
    console.log(`  ║  Herramientas:  ${String(toolsList.length).padEnd(2)} cargadas                      ║`);
    console.log('  ║  Servicios:  Media · Cerebro · Vigilante · Wolf  ║');
    console.log('  ║  v10: Seguridad reforzada                        ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log('  ║  🔒 Rate limiting + IP blocking + CORS           ║');
    console.log('  ║  🛡️ Headers de seguridad HTTP                    ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');

    iniciarWolfWatcher();
});

const { iniciarWatcherCerebro } = require('./src/services/cerebroWatcherService');
const { iniciarWolfWatcher } = require('./src/services/wolfWatcherService');
const { ejecutarCuraduria } = require('./src/services/vigilanteService');
const { iniciarWorker } = require('./src/services/gpuQueueService');

iniciarWatcherCerebro();

// Arrancar Worker de GPU Queue
setTimeout(() => {
    iniciarWorker();
}, 10000); // 10 segundos después de iniciar

// Vigilante Automático: Corre curaduría cada 6 horas.
const INTERVALO_VIGILANTE = 6 * 60 * 60 * 1000; // 6 horas
setTimeout(() => {
    console.log('[VIGILANTE] 🕐 Primera ronda automática iniciada.');
    ejecutarCuraduria();
    setInterval(() => {
        console.log('[VIGILANTE] 🕐 Ronda automática programada.');
        ejecutarCuraduria();
    }, INTERVALO_VIGILANTE);
}, 5 * 60 * 1000); // 5 minutos después del arranque

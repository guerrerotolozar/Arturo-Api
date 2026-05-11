/**
 * index.js — Punto de entrada principal del servidor Arturo.
 * Solo Express, rutas y middlewares. CERO lógica de negocio.
 */

const express = require('express');
const { PORT } = require('./src/config/env');

// Importar Thin Controllers
const consultaIAFast = require('./src/controllers/IAfast');
const limpiarInbox   = require('./src/controllers/conserje');
const crearNota      = require('./src/controllers/nota');
const obtenerStatus  = require('./src/controllers/status');
const { obtenerGrafo, obtenerStatsGrafo } = require('./src/controllers/grafo');
const procesarVision = require('./src/controllers/vision');
const downloadDirecto = require('./src/controllers/download');
const { listarChatsController, eliminarChatController, obtenerMensajesController } = require('./src/controllers/chats');
const { syncVectoresController, estadoVectoresController, estadoVRAMController, liberarVRAMController } = require('./src/controllers/vectores');
const { iniciarWSVoz } = require('./src/controllers/wsVoice');
const { enviarNotificacion, obtenerNotificaciones, streamNotificaciones } = require('./src/controllers/notificaciones');
const bancolombiaService = require('./src/services/bancolombiaService');

const app = express();

// Middlewares
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-arturo-key');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json({ limit: '50mb' })); // v8.6: Aumentado para soportar videos Base64

// v7: Autenticación por API Key (requerida cuando Arturo está expuesto vía Tailscale Funnel)
const authGuard = require('./src/middlewares/authGuard');
app.use(authGuard);

// ============================================================
// RUTAS DE LA API
// ============================================================

// 1. Agentes y Consultas
app.post('/IA/fast', consultaIAFast);            // El Agente Rápido (Tool Calling)
app.post('/IA/limpiar-inbox', limpiarInbox);     // El Conserje / Organizador
app.post('/IA/vision', procesarVision);          // Procesado de Visión
app.post('/IA/download', downloadDirecto);        // Descarga directa (sin LLM) — Share Target

// 2. Creación
app.post('/IA/nota', crearNota);                 // Crear notas estructuradas

// 3. Memoria Conversacional
app.get('/IA/chats', listarChatsController);      // Lista todos los chats
app.get('/IA/chats/:id/mensajes', obtenerMensajesController); // Mensajes de un chat
app.delete('/IA/chats/:id', eliminarChatController); // Elimina un chat

// 4. Sistema y Grafo
app.get('/IA/grafo', obtenerGrafo);              // Nodos para Three.js
app.get('/IA/grafo/stats', obtenerStatsGrafo);   // Estadísticas de conexiones
app.get('/status', obtenerStatus);               // Health-check (Vault, Ollama)

// 5. Base Vectorial y VRAM
app.post('/IA/vectores/sync', syncVectoresController);     // Sincronizar Bóveda → LanceDB
app.get('/IA/vectores/estado', estadoVectoresController);  // Estado de LanceDB
app.get('/IA/vram/estado', estadoVRAMController);          // Modelos cargados en VRAM
app.post('/IA/vram/liberar', liberarVRAMController);       // Liberar VRAM (descargar pesados)

// 6. Notificaciones Push (Bot Trading → App Android)
app.post('/IA/notify', enviarNotificacion);                  // Encolar notificación
app.get('/IA/notifications', obtenerNotificaciones);         // Recoger pendientes (polling fallback)
app.get('/IA/notifications/stream', streamNotificaciones);   // SSE en tiempo real (push instantáneo)

// ============================================================
// INICIO DEL SERVIDOR 
// ============================================================
const { tools } = require('./src/tools');

const server = app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║                    Arturo                    ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log(`  ║  Puerto:        ${PORT}                         ║`);
    console.log(`  ║  Herramientas:  ${String(tools.length).padEnd(2)} cargadas                  ║`);
    console.log(`  ║  Servicios:     IMAP · WS Voz · Media        ║`);
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
});

iniciarWSVoz(server);
bancolombiaService.init();

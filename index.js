/**
 * index.js — Punto de entrada principal del servidor Arturo.
 * Solo Express, rutas y middlewares. CERO lógica de negocio.
 */

const express = require('express');
const { PORT } = require('./src/config/env');

// Importar Thin Controllers
const consultaIAFast = require('./src/controllers/IAfast');
const limpiarInbox   = require('./src/controllers/conserje');
const consultaIA     = require('./src/controllers/IA');
const webhookCerebro = require('./src/controllers/cerebro');
const crearNota      = require('./src/controllers/nota');
const obtenerStatus  = require('./src/controllers/status');
const { obtenerGrafo, obtenerStatsGrafo } = require('./src/controllers/grafo');
const procesarVision = require('./src/controllers/vision');
const { listarChatsController, eliminarChatController, obtenerMensajesController } = require('./src/controllers/chats');
const { syncVectoresController, estadoVectoresController, estadoVRAMController, liberarVRAMController } = require('./src/controllers/vectores');
// ¡Crítico! Esto inicializa el WebSocket para que la app del celular conecte la voz
const { iniciarWSVoz } = require('./src/controllers/wsVoice');

const app = express();

// Middlewares
app.use(express.json({ limit: '10mb' })); // v6.2: Aumentado para soportar imágenes Base64 desde la app

// v7: Autenticación por API Key (requerida cuando Arturo está expuesto vía Tailscale Funnel)
const authGuard = require('./src/middlewares/authGuard');
app.use(authGuard);

// ============================================================
// RUTAS DE LA API
// ============================================================

// 1. Agentes y Consultas
app.post('/IA/fast', consultaIAFast);            // El Agente Rápido (Tool Calling)
app.post('/IA/consultar', consultaIA);           // RAG Profundo + Web
app.post('/IA/limpiar-inbox', limpiarInbox);     // El Conserje / Organizador
app.post('/IA/vision', procesarVision);          // Procesado de Visión

// 2. Ingestión y Creación
app.post('/IA/cerebro', webhookCerebro);         // Webhook para ideas crudas
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

// ============================================================
// INICIO DEL SERVIDOR 
// ============================================================
const server = app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`[SERVIDOR] 🧠 Arturo V7 (SOLID) despertó.`);
    console.log(`\n[ORGANIZADOR V7 - SOLID] Iniciando procesamiento en SEGUNDO PLANO...`);
    console.log(`[SERVIDOR] Escuchando en el puerto ${PORT}`);
    console.log(`==================================================\n`);
});

iniciarWSVoz(server);

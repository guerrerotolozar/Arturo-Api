/**
 * Arturo — Servidor principal del Segundo Cerebro.
 * Punto de entrada limpio: solo Express + rutas + inyección de controladores.
 *
 * env.js ya ejecuta dotenv.config() — no se repite aquí.
 */

const express = require('express');
const { PORT, TAVILY_API_KEY } = require('./src/config/env');
const path = require('path');

// Controladores
const webhookCerebro = require('./src/controllers/cerebro');
const consultaIA = require('./src/controllers/IA');
const consultaIAFast = require('./src/controllers/IAfast');
const crearNota = require('./src/controllers/nota');
const { obtenerGrafo, obtenerStatsGrafo } = require('./src/controllers/grafo');
const obtenerStatus = require('./src/controllers/status');
const limpiarInbox = require('./src/controllers/conserje');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// RUTAS
// ============================================================

// Prueba de vida rápida
app.get('/ping', (req, res) => res.send('Arturo está operando correctamente'));

// Health check completo
app.get('/api/status', obtenerStatus);

// Webhook del Segundo Cerebro — Motor FAST (qwen2.5:1.5B)
app.post('/webhook/cerebro', webhookCerebro);

// IA — Consulta RAG + Web híbrida — Motor DEEP (qwen2.5:14b)
app.post('/IA/consultar', consultaIA);

// IA FAST — Consultas rápidas sin RAG — Motor FAST (qwen2.5:1.5B)
app.post('/IA/fast', consultaIAFast);

// IA NOTA — Crea notas estructuradas en el vault
app.post('/IA/nota', crearNota);

// IA ORGANIZADOR — Limpia y estructura el Inbox — Motor DEEP (qwen2.5:14b)
app.post('/IA/limpiar-inbox', limpiarInbox);

// Grafo 3D — JSON de nodos y enlaces
app.get('/api/grafo', obtenerGrafo);

// Grafo 3D — Estadísticas: hubs, huérfanos, por carpeta
app.get('/api/grafo/stats', obtenerStatsGrafo);

// ============================================================
// ARRANQUE
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n══════════════════════════════════════`);
    console.log(`  Arturo operando en http://192.168.1.8:${PORT}`);
    console.log(`══════════════════════════════════════`);
    console.log(`  POST /webhook/cerebro      → Ingestión de ideas`);
    console.log(`  POST /IA/consultar     → RAG + Web (qwen2.5:14b)`);
    console.log(`  POST //fast          → Consulta rápida (qwen2.5:1.5B)`);
    console.log(`  POST /IA/nota          → Crear nota estructurada`);
    console.log(`  GET  /api/grafo            → Grafo 3D JSON`);
    console.log(`  GET  /api/grafo/stats      → Stats del grafo`);
    console.log(`  GET  /api/status           → Health check`);
    console.log(`──────────────────────────────────────`);
    console.log(`  [TAVILY] ${TAVILY_API_KEY ? '✅ Configurada' : '⚠️  Sin API Key'}`);
    console.log(`══════════════════════════════════════\n`);
});
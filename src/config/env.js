/**
 * env.js — Fuente única de verdad para toda la configuración de Arturo.
 * dotenv se carga UNA SOLA VEZ aquí. El resto de la app solo importa constantes.
 */

const fs = require('fs');
const path = require('path');

// v7.1: Carga absoluta del .env para permitir ejecutar scripts desde subcarpetas
require('dotenv').config({ path: path.join(__dirname, '../../.env') });


// ============================================================
// VAULT & PROMPTS
// ============================================================
const VAULT_PATH = process.env.VAULT_PATH
const VAULT_PATH_BOVEDA = process.env.VAULT_PATH_BOVEDA

// ============================================================
// OLLAMA
// ============================================================
const OLLAMA_URL = process.env.OLLAMA_URL
const OLLAMA_MODEL = process.env.OLLAMA_MODEL
const OLLAMA_MODEL_VISION = process.env.OLLAMA_MODEL_VISION
const OLLAMA_MODEL_EMBED = process.env.OLLAMA_MODEL_EMBED

// ============================================================
// SEMANTIC BRIDGE (Semantic Bridge / Linker)
// v7.2: El "puente" semántico entre videos/arteFuturo y proyectos
// =================================================================
/**
 * Modelo usado exclusivamente para generar embeddings (vectores).
 * No se usa para texto ni generación — su rol es solo convertir texto → vector.
 */
const EMBED_MODEL = (process.env.SEMANTIC_BRIDGE_EMBED_MODEL || process.env.OLLAMA_MODEL_EMBED || '').trim() || 'qwen3-embedding:8b'

// Modelo usado por el Semantic Bridge para generar NOTIFICACIONES.
// Debe ser un modelo LLM con razonamiento semántico, no solo embedding.
const SEMANTIC_BRIDGE_GENERATE_MODEL = process.env.SEMANTIC_BRIDGE_GENERATE_MODEL || 'ornith-1.5:9b'

/**
 * Umbral de similitad vectorial (%). Si la nota/roamap tiene > X% semántico con video nuevo, se genera notificación.
 */
const RELEVANCE_THRESHOLD = process.env.SEMANTIC_BRIDGE_RELEVANCE_THRESHOLD || '75'

/**
 * Si true, el Semantic Bridge evalúa semánticamente cada nota de Boveda en contra del resumen del nuevo video y envía notificaciones a la app cuando aplica.
 */
const SEMANTIC_BRIDGE_ENABLED = (process.env.SEMANTIC_BRIDGE_ENABLED || 'false').toLowerCase() === 'true'

// ============================================================
// Flag para habilitar/deshabilitar el intento del modelo Deep.
// En false: deep_analysis usa directamente el Fast con prompt enriquecido (sin esperar timeout).
// Cuando llegue la RTX 5060 Ti, cambiar a true en .env.
const DEEP_ANALYSIS_ENABLED = (process.env.DEEP_ANALYSIS_ENABLED || 'false').toLowerCase() === 'true'

// ============================================================
// WHISPER
// ============================================================
const WHISPER_BIN = process.env.WHISPER_BIN
const WHISPER_MODEL = process.env.WHISPER_MODEL

// ============================================================
// PIPER
// ============================================================
const PIPER_BIN = process.env.PIPER_BIN
const PIPER_MODEL = process.env.PIPER_MODEL

// ============================================================
// TAVILY
// ============================================================
const TAVILY_API_KEY = process.env.TAVILY_API_KEY
const TAVILY_URL = process.env.TAVILY_URL

// ============================================================
// IMAP - BANCOLOMBIA
// ============================================================
const IMAP_USER = process.env.IMAP_USER
const IMAP_PASSWORD = process.env.IMAP_PASSWORD
const IMAP_HOST = process.env.IMAP_HOST
const IMAP_PORT = process.env.IMAP_PORT
const IMAP_MAILBOX = process.env.IMAP_MAILBOX

// ============================================================
// MEDIA DOWNLOADER
// ============================================================
const MEDIA_PATH = process.env.MEDIA_PATH
const COOKIES_PATH = process.env.COOKIES_PATH

// ============================================================
// GPU QUEUE CONFIG
// ============================================================
const GPU_VRAM_THRESHOLD_MB = parseInt(process.env.GPU_VRAM_THRESHOLD_MB || '12000', 10)
const GPU_UTIL_THRESHOLD_PCT = parseInt(process.env.GPU_UTIL_THRESHOLD_PCT || '85', 10)
const GPU_QUEUE_CHECK_INTERVAL_MS = parseInt(process.env.GPU_QUEUE_CHECK_INTERVAL_MS || '30000', 10)

// ============================================================
// SERVIDOR
// ============================================================
const PORT = process.env.PORT
const ARTURO_API_KEY_MOBILE = process.env.ARTURO_API_KEY_MOBILE
const ARTURO_API_KEY_DESKTOP = process.env.ARTURO_API_KEY_DESKTOP

// ============================================================
// Prompts Traidos de el Cerebro
// ============================================================

const PROMPTS_PATH = process.env.PROMPTS_PATH
const PROMPT_VISION = process.env.PROMPT_VISION

// ============================================================
// PERFIL DE RONALD — Instrucciones permanentes para IA
// ============================================================
const PERFIL_RONALD = process.env.PERFIL_RONALD

// ============================================================
// VALIDACIONES AL ARRANQUE
// ============================================================
if (!TAVILY_API_KEY) {
    console.warn('[CONFIG] ⚠️  TAVILY_API_KEY ausente en .env — búsqueda web deshabilitada.');
}

if (VAULT_PATH && !fs.existsSync(VAULT_PATH)) {
    fs.mkdirSync(VAULT_PATH, { recursive: true });
    console.log(`[CONFIG] Vault creado en: ${VAULT_PATH}`);
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    VAULT_PATH,
    VAULT_PATH_BOVEDA,
    OLLAMA_URL,
    OLLAMA_MODEL,
    OLLAMA_MODEL_VISION,
    OLLAMA_MODEL_EMBED,
    PROMPTS_PATH,
    WHISPER_BIN,
    WHISPER_MODEL,
    PIPER_BIN,
    PIPER_MODEL,
    PROMPT_VISION,
    TAVILY_API_KEY,
    TAVILY_URL,
    PORT,
    PERFIL_RONALD,
    ARTURO_API_KEY_MOBILE,
    ARTURO_API_KEY_DESKTOP,
    IMAP_USER,
    IMAP_PASSWORD,
    IMAP_HOST,
    IMAP_PORT,
    IMAP_MAILBOX,
    MEDIA_PATH,
    COOKIES_PATH,
    GPU_VRAM_THRESHOLD_MB,
    GPU_UTIL_THRESHOLD_PCT,
    GPU_QUEUE_CHECK_INTERVAL_MS
};
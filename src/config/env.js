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
const OLLAMA_MODEL_FAST = process.env.OLLAMA_MODEL_FAST
const OLLAMA_MODEL_DEEP = process.env.OLLAMA_MODEL_DEEP
const OLLAMA_MODEL_EMBED = process.env.OLLAMA_MODEL_EMBED
const OLLAMA_MODEL_VISION = process.env.OLLAMA_MODEL_VISION

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
    OLLAMA_MODEL_FAST,
    OLLAMA_MODEL_DEEP,
    DEEP_ANALYSIS_ENABLED,
    OLLAMA_MODEL_EMBED,
    PROMPTS_PATH,
    OLLAMA_MODEL_VISION,
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
    COOKIES_PATH
};
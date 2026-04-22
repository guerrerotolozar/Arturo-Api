/**
 * env.js — Fuente única de verdad para toda la configuración de Arturo.
 * dotenv se carga UNA SOLA VEZ aquí. El resto de la app solo importa constantes.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

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
// SERVIDOR
// ============================================================
const PORT = process.env.PORT
const ARTURO_API_KEY = process.env.ARTURO_API_KEY

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

if (!fs.existsSync(VAULT_PATH)) {
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
    ARTURO_API_KEY
};
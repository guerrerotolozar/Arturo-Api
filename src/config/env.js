/**
 * env.js — Fuente única de verdad para toda la configuración de Arturo.
 * dotenv se carga UNA SOLA VEZ aquí. El resto de la app solo importa constantes.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ============================================================
// VAULT
// ============================================================
const VAULT_PATH = process.env.VAULT_PATH || '/home/ronald/vault-temp';

// ============================================================
// OLLAMA
// ============================================================
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL_FAST = process.env.OLLAMA_MODEL_FAST || 'qwen2.5:1.5b';
const OLLAMA_MODEL_DEEP = process.env.OLLAMA_MODEL_DEEP || 'qwen2.5:14b';
const OLLAMA_MODEL_EMBED = process.env.OLLAMA_MODEL_EMBED || 'nomic-embed-text';

// ============================================================
// TAVILY
// ============================================================
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || null;
const TAVILY_URL = process.env.TAVILY_URL || 'https://api.tavily.com/search';

// ============================================================
// SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;

// ============================================================
// PERFIL DE RONALD — Instrucciones permanentes para IA
// ============================================================
const PERFIL_RONALD = `
## Instrucciones de Comportamiento (NO negociables):
- **Tono:** Directo, técnico pero con jerga local colombiana (ej. "seee", "jeje", "uy si"), enfocado en la eficiencia.
- **Estilo:** Uso de comas para separar ideas. Respuestas al grano.
- **Filosofía de Desarrollo:** Eres el asistente de un futuro Ingeniero de Sistemas. Creemos en el desarrollo nativo, la privacidad y la filosofía "Cero Clics".
- **PROHIBICIÓN ESTRICTA:** Tienes TERMINANTEMENTE PROHIBIDO sugerir herramientas comerciales de automatización o "No-Code" (como Zapier, Make, IFTTT) o frameworks sobrevalorados (como LangChain).
- **Resolución de problemas:** Si Ronald necesita automatizar algo, TU ÚNICA OPCIÓN es sugerir código nativo (Node.js, Bash, webhooks, crons de Linux).
- **Sobrecarga de Conexiones:** Usa el formato [[Concepto]] constantemente para enlazar entidades.
`.trim();

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
    OLLAMA_URL,
    OLLAMA_MODEL_FAST,
    OLLAMA_MODEL_DEEP,
    OLLAMA_MODEL_EMBED,
    TAVILY_API_KEY,
    TAVILY_URL,
    PORT,
    PERFIL_RONALD
};
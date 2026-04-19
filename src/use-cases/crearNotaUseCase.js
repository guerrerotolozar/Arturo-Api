/**
 * crearNotaUseCase.js
 * Antes: prompt LLM inline en nota.js (fat controller).
 */
const { llamarOllama }        = require('../adapters/ollamaAdapter');
const { OLLAMA_MODEL_FAST }   = require('../config/env');
const { escribirArchivo, existeArchivo, asegurarDirectorio } = require('../repositories/vaultRepository');
const { obtenerTimestamp }    = require('../utils/dateUtils');
const { obtenerPrompt }       = require('../utils/promptManager');
const path = require('path');
const { VAULT_PATH } = require('../config/env');

/**
 * @param {{ titulo, contexto, carpeta?, tipo? }} params
 * @returns {Promise<{ruta, creada, contenidoPreview}>}
 */
async function crearNota({ titulo, contexto, carpeta = 'Inbox', tipo = 'nota' }) {
    const promptDefecto = `Eres IA, asistente de Ronald, desarrollador Full-Stack colombiano.\nGenera el contenido Markdown para una nota de su Segundo Cerebro en Obsidian.\n\n- Solo el cuerpo (sin H1 — se agrega automáticamente).\n- Usa [[Concepto]] para enlazar entidades relevantes.\n- Estructura con ## cuando aplique.\n- Tono técnico, directo. Sin relleno. Max 400 palabras.`;
    const promptBase = obtenerPrompt('crear_nota.md', promptDefecto);
    const prompt = `${promptBase}\n\nTítulo: "${titulo}" | Tipo: ${tipo} | Carpeta: ${carpeta}\nContexto: ${contexto}\n\nContenido Markdown:`;

    const contenido = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
    const nombre    = titulo.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_');
    const dir       = path.join(VAULT_PATH, carpeta);
    const rutaAbs   = path.join(dir, `${nombre}.md`);
    const rutaRel   = `${carpeta}/${nombre}.md`;

    if (existeArchivo(rutaAbs)) {
        return { ruta: rutaRel, creada: false, contenidoPreview: '' };
    }

    const ts = obtenerTimestamp();
    const md = ['---', `tipo: ${tipo}`, `creado: ${ts}`, `fuente: IA_nota`, '---', `# ${titulo}`, '', contenido].join('\n');
    escribirArchivo(rutaAbs, md);

    return { ruta: rutaRel, creada: true, contenidoPreview: contenido.substring(0, 200) };
}

module.exports = { crearNota };
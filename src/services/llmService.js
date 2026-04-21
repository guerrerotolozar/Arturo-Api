/**
 * llmService.js v5 — Limpio, Modular, y SOLID.
 * Solo contiene lógica de wrappers para hablar con Ollama invocando prompts externos.
 * Las heurísticas de texto se mudaron a src/utils/textHeuristics.js
 */
const { llamarOllama } = require('../adapters/ollamaAdapter');
const { obtenerPrompt } = require('../utils/promptManager');
const { OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { esPreguntaSimple, tieneSenalesWeb } = require('../utils/textHeuristics');
const { extraerJSONValido } = require('../utils/jsonExtractor');

// ── Clasificación de intención (UX Web) ──────────

async function necesitaInternet(pregunta) {
    if (tieneSenalesWeb(pregunta)) {
        console.log('[INTENT] Señal explicita → SI web.');
        return true;
    }
    const promptDefecto = `Determina si esta pregunta necesita datos actualizados de internet.\nSI: tiempo real, temporalidad reciente, mercados actuales.\nNO: conceptos estables, preguntas sobre notas propias.\nResponde UNICAMENTE "SI" o "NO".`;
    const promptBase = obtenerPrompt('necesita_internet.md', promptDefecto);
    const prompt = `${promptBase}\nPregunta: "${pregunta}"`;
    try {
        const r = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);
        return r.trim().toUpperCase().startsWith('SI');
    } catch { return false; }
}

// ── Motores de Respuesta Directa ────────────────────────────────

async function consultarIAFast(pregunta, origen = '') {
    const contextoOrigen = origen ? `[METADATA: Estás hablando con Ronald. Dispositivo actual: ${origen}]` : '';
    const identidad = obtenerPrompt('ia_fast.md', `IDENTIDAD OBLIGATORIA:\n- TU eres Arturo V6, asistente personal.\n- EL USUARIO es Ronald, tu creador.\n- Si preguntan "quien soy?", responde "Eres Ronald".\nResponde SIEMPRE en español. Tono tecnico, directo. Max 3 parrafos.`);
    if (esPreguntaSimple(pregunta)) {
        return llamarOllama(`${identidad}\n${contextoOrigen}\nResponde directo y breve, max 2 lineas.\nPregunta: ${pregunta}\nRespuesta:`, OLLAMA_MODEL_FAST);
    }
    return llamarOllama(`${identidad}\n${contextoOrigen}\n\nPregunta: ${pregunta}\n\nRespuesta:`, OLLAMA_MODEL_FAST);
}

// ── Orquestador de Agente Tool-Calling ───────────────────────────────

const { generarDescripcionHerramientas } = require('../tools');

async function orquestarTareas(pregunta) {
    const herramientas = generarDescripcionHerramientas();
    const promptDefecto = `Eres el Dispatcher de Arturo. Tu UNICO trabajo es elegir la(s) herramienta(s) correcta(s) y extraer los parametros del usuario. NUNCA respondas la pregunta. NUNCA escribas codigo.
REGLAS:
1. TOLERANCIA: Ignora faltas ortograficas. Infiere la intencion real.
2. NOTAS/GUARDAR: Si el usuario dice "anota", "guarda", "agrega", "apunta" o "recuerda" → USA "vault_append" SIEMPRE. Esta es tu PRIORIDAD MAXIMA.
3. VISUAL / URLs: Si el texto empieza con "[CONTEXTO VISUAL...]" o contiene una URL, Y ADEMAS el usuario dice "anota/guarda", NO HAGAS "tavily_search" para investigar la foto/url. Usa "vault_append" DIRECTAMENTE mandando todo el contenido extraido/visto allí. 
4. CADENA DE HERRAMIENTAS: Puedes usar MULTIPLES herramientas en secuencia. Ejemplo: buscar info de conocimiento puro con "tavily_search" Y LUEGO guardarla con "vault_append".
5. MATEMATICAS: Si hay numeros, formulas, calculos financieros o matematicos, usa "calcular".
6. PARAMETROS: Extrae los valores del texto del usuario (montos, URLs, temas, etc).
7. FORMATO: Solo JSON estricto. Las claves DEBEN llevar comillas dobles.

EJEMPLOS:

Usuario: "anota esto en hardware: https://speedlogic.com.co/tarjeta-rtx-5060ti"
Respuesta: {"tareas": [{"herramienta": "vault_append", "parametros": {"query": "hardware", "contenido": "https://speedlogic.com.co/tarjeta-rtx-5060ti"}}]}

Usuario: "[CONTEXTO VISUAL de imagen adjunta: Tarjeta De Video...] Petición de Ronald: https://speedlogic.com/ anota esto en una nueva nota"
Respuesta: {"tareas": [{"herramienta": "vault_append", "parametros": {"query": "nueva_nota", "contenido": "{{texto_del_usuario}}"}}]}

Usuario: "busca precios del RTX 5060 Ti y guardalo en mis notas de hardware"
Respuesta: {"tareas": [{"herramienta": "tavily_search", "parametros": {"query": "precio RTX 5060 Ti Colombia"}}, {"herramienta": "vault_append", "parametros": {"query": "hardware", "contenido": "{{resultado_anterior}}"}}]}

Usuario: "anota esto en una nueva nota, puede ser en hardware"
Respuesta: {"tareas": [{"herramienta": "vault_append", "parametros": {"query": "hardware", "contenido": "{{texto_del_usuario}}"}}]}

Usuario: "tabla de amortizacion de 1000 a 10 meses al 5% mensual"
Respuesta: {"tareas": [{"herramienta": "calcular", "parametros": {"tipo": "amortizacion", "monto": 1000, "tasa": 0.05, "meses": 10}}]}\n`;

    const promptBase = obtenerPrompt('orquestador.md', promptDefecto);
    const prompt = `${promptBase}\nHerramientas disponibles:\n${herramientas}\n\nPeticion: "${pregunta}"`;
    
    // REPARACIÓN CRÍTICA: Ahora que usamos qwen2.5:3b (no-reasoning),
    // PODEMOS devolverle el bozal JSON a Ollama. Esto hace que sea MATEMÁTICAMENTE
    // IMPOSIBLE que la IA escupa caracteres chinos, ya que Ollama rebotará 
    // a nivel del motor cualquier letra que rompa el JSON estricto.
    const raw = await llamarOllama(prompt, OLLAMA_MODEL_FAST, 'json');
    
    // Guardrail: Extractor quirúrgico por conteo de llaves.
    // Aísla el primer JSON completo y descarta alucinaciones (ChatML, chino, etc.)
    const jsonLimpio = extraerJSONValido(raw);

    if (!jsonLimpio) {
        console.error('[GUARDRAIL ALERT] No se encontró JSON válido en la respuesta del orquestador.\nRespuesta Cruda:', raw);
        return { tareas: [] };
    }

    try { 
        const parsed = JSON.parse(jsonLimpio);
        return parsed.tareas ? parsed : { tareas: [] };
    } catch (err) { 
        console.error('[GUARDRAIL ALERT] JSON encontrado pero inválido:', err.message, '\nJSON Extraído:', jsonLimpio);
        return { tareas: [] }; 
    }
}

async function sintetizarRespuestaAgente(pregunta, datosAcumulados, origen = '') {
    const contextoOrigen = origen ? `[METADATA: Estás hablando con Ronald. Dispositivo actual: ${origen}]\n` : '';
    const promptDefecto = `Eres Arturo, el asistente de Ronald. ${PERFIL_RONALD}\n- No expliques que herramientas usaste. Solo da la respuesta.`;
    const promptBase = obtenerPrompt('sintetizador_agente.md', promptDefecto);
    const prompt = `${promptBase}\n\n${contextoOrigen}Datos obtenidos por las herramientas:\n"${datosAcumulados.trim()}"\n\nPregunta original de Ronald: "${pregunta}"\n\nRespuesta:`;
    return llamarOllama(prompt, OLLAMA_MODEL_FAST);
}

// ── RAG + Web (Híbrido) ───────────────────────────────────────────────────────

async function consultarIA(pregunta, fragmentosVault, datosWeb, fechaHora) {
    const bloqueVault = fragmentosVault.length > 0
        ? `\n${fragmentosVault.map((f, i) => `[${i+1}] ${f.fuente}\n${f.texto}`).join('\n\n')}\n`
        : 'Sin contexto local.';
    const bloqueWeb = datosWeb
        ? `\n${datosWeb.answer ? `Resumen: ${datosWeb.answer}\n` : ''}${datosWeb.results.map(r => `${r.title}\n${r.content}`).join('\n')}\n`
        : 'Sin contexto web.';
        
    const promptDefecto = `Eres IA Híbrida. Usa los datos a continuación para responder la pregunta técnica.`;
    let promptBase = obtenerPrompt('consultar_ia_rag.md', promptDefecto);
    
    // Inyectar el perfil de Ronald explícitamente porque es un reemplazo dinámico de variable
    promptBase = promptBase.replace('---PERFIL_RONALD---', PERFIL_RONALD || 'Actúa como asistente.');
    
    const prompt = `${promptBase}\n\nFecha Local: ${fechaHora}\n\n=== CONTEXTO DE BÓVEDA ===${bloqueVault}\n=== CONTEXTO DE INTERNET ===${bloqueWeb}\n=== FIN CONTEXTOS ===\n\nPregunta: "${pregunta}"\n\nRespuesta:`;
    
    return llamarOllama(prompt, OLLAMA_MODEL_DEEP);
}

// ── Inbox: Análisis y Fusión ───────────────────────────────────────────

async function analizarIntenciones(textoNota) {
    const promptDefecto = `Extrae intencion. JSON: {"necesitaWeb":bool,"queryWeb":"txt","topicPrincipal":"txt"}`;
    const promptBase = obtenerPrompt('analizar_intenciones.md', promptDefecto);
    const prompt = `${promptBase}\n\nNOTA: "${textoNota.replace(/"/g, "'").substring(0, 600)}"\nRESULTADO:`;
    try {
        const raw = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);
        const jsonLimpio = extraerJSONValido(raw);
        if (!jsonLimpio) throw new Error('No JSON found');
        const r = JSON.parse(jsonLimpio);
        return {
            necesitaWeb: Boolean(r.necesitaWeb),
            queryWeb: (r.queryWeb || '').trim(),
            topicPrincipal: (r.topicPrincipal || 'sin clasificar').trim()
        };
    } catch { return { necesitaWeb: false, queryWeb: '', topicPrincipal: 'sin clasificar' }; }
}

async function verificarFusion(textoInbox, textoCandidato, nombreCandidato) {
    const promptDefecto = `¿Hablan del mismo tema preciso para fusionarse? Responde SI o NO.`;
    const promptBase = obtenerPrompt('verificar_fusion.md', promptDefecto);
    const prompt = `${promptBase}\n\nTEXTO NUEVO: """${textoInbox.substring(0, 350)}"""\nTEXTO EXISTENTE (${nombreCandidato}): """${textoCandidato.substring(0, 350)}"""\n\nRespuesta Binaria (SI/NO):`;
    try {
        const r = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
        return r.trim().toUpperCase().startsWith('SI');
    } catch { return false; }
}

// ── Categorización de Ideas ───────────────────────────────────────────────

async function clasificarIdea(idea, categorias) {
    const promptDefecto = `Propone UN nombre de categoria PascalCase.`;
    const promptBase = obtenerPrompt('clasificar_idea.md', promptDefecto);
    const categoriasTxt = categorias.length === 0 ? "Ninguna, debes crearla." : categorias.join(', ');
    const prompt = `${promptBase}\n\nIDEA: "${idea}"\nCATEGORÍAS ACTUALES: ${categoriasTxt}\n\nCategoría:`;
    try {
        const r = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
        const limpia = r.split('\n')[0].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '').trim();
        if (!limpia) return 'Inbox';
        if (categorias.length > 0) {
            const match = categorias.find(c => c.toLowerCase() === limpia.toLowerCase()) || categorias.find(c => limpia.toLowerCase().includes(c.toLowerCase()));
            if (match) return match;
        }
        return limpia;
    } catch { return 'Inbox'; }
}

module.exports = {
    necesitaInternet,
    consultarIAFast,
    consultarIA,
    orquestarTareas,
    sintetizarRespuestaAgente,
    analizarIntenciones,
    verificarFusion,
    clasificarIdea,
    _esPreguntaSimple: esPreguntaSimple,
};
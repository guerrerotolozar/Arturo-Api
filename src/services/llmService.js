/**
 * llmService.js v6 — Post-Auditoría.
 *
 * Funciones VIVAS:
 *   - consultarIAFast   → Respuesta directa (Fast-Path del agente)
 *   - orquestarTareas   → Genera plan JSON de herramientas
 *   - sintetizarRespuestaAgente → Sintetiza resultados de tools
 *   - analizarIntenciones → Clasificación de notas del Inbox
 *   - verificarFusion   → Verifica si dos notas son fusionables
 *
 * ELIMINADO en esta versión:
 *   - necesitaInternet() — Solo la usaba consultaHibridaUseCase (eliminado)
 *   - consultarIA()      — Solo la usaba consultaHibridaUseCase (eliminado)
 *   - clasificarIdea()   — Solo la usaba ingestionIdeaUseCase (eliminado)
 */
const { llamarOllama } = require('../adapters/ollamaAdapter');
const { obtenerPrompt } = require('../utils/promptManager');
const { OLLAMA_MODEL_FAST, PERFIL_RONALD } = require('../config/env');
const { extraerJSONValido } = require('../utils/jsonExtractor');

// ── Motor de Respuesta Directa ────────────────────────────────

async function consultarIAFast(pregunta, origen = '', historial = []) {
    const contextoOrigen = origen ? `[METADATA: Estás hablando con Ronald. Dispositivo actual: ${origen}]\n` : '';
    const identidad = obtenerPrompt('ia_fast.md', `Eres Arturo V8.5, el Segundo Cerebro de Ronald. Responde en español. Tono directo. Adapta la longitud a la complejidad de la pregunta.`);
    
    // Construir bloque de historial
    let bloqueHistorial = '';
    if (historial.length > 0) {
        const lineas = historial.map(m => {
            const quien = m.rol === 'user' ? 'Ronald' : 'Arturo';
            return `[${quien}]: ${m.contenido}`;
        }).join('\n');
        bloqueHistorial = `\n=== HISTORIAL RECIENTE ===\n${lineas}\n=== FIN HISTORIAL ===\n`;
    }

    return llamarOllama(`${identidad}\n${contextoOrigen}${bloqueHistorial}\nPregunta: "${pregunta}"\nRespuesta:`, OLLAMA_MODEL_FAST);
}

// ── Orquestador de Agente Tool-Calling ───────────────────────────────

const { generarDescripcionHerramientas } = require('../tools');

async function orquestarTareas(pregunta, historial = []) {
    const herramientas = generarDescripcionHerramientas();
    const promptDefecto = `Eres Arturo V8.5, Orquestador del Segundo Cerebro. Planifica herramientas en JSON estricto. NUNCA respondas la pregunta.
Proceso: 1.Asociar(vault_search) 2.Actuar 3.Persistir(vault_append) 4.Escalar(deep_analysis si es complejo) 5.respuesta_directa solo para charla casual.
JSON estricto. Claves con comillas dobles.`;

    const promptBase = obtenerPrompt('orquestador.md', promptDefecto);

    // Inyectar historial de conversación si existe
    let bloqueHistorial = '';
    if (historial.length > 0) {
        const lineas = historial.map(m => {
            const quien = m.rol === 'user' ? 'Ronald' : 'Arturo';
            return `[${quien}]: ${m.contenido}`;
        }).join('\n');
        bloqueHistorial = `\n=== HISTORIAL DE CONVERSACIÓN ===\n${lineas}\n=== FIN HISTORIAL ===\n`;
    }

    const prompt = `${promptBase}\nHerramientas disponibles:\n${herramientas}${bloqueHistorial}\n\nPeticion: "${pregunta}"`;
    
    const raw = await llamarOllama(prompt, OLLAMA_MODEL_FAST, 'json');
    
    // Guardrail: Extractor quirúrgico por conteo de llaves.
    const jsonLimpio = extraerJSONValido(raw);

    if (!jsonLimpio) {
        console.error('[GUARDRAIL ALERT] ⚠️ No se encontró JSON válido en la respuesta del orquestador.');
        console.error('[GUARDRAIL ALERT] Respuesta cruda (primeros 300 chars):', raw.substring(0, 300));
        return { tareas: [{ herramienta: 'respuesta_directa', parametros: {} }] };
    }

    try { 
        const parsed = JSON.parse(jsonLimpio);
        return parsed.tareas ? parsed : { tareas: [] };
    } catch (err) { 
        console.error('[GUARDRAIL ALERT] JSON encontrado pero inválido:', err.message, '\nJSON Extraído:', jsonLimpio);
        return { tareas: [] }; 
    }
}

async function sintetizarRespuestaAgente(pregunta, datosAcumulados, origen = '', historial = []) {
    const contextoOrigen = origen ? `[METADATA: Estás hablando con Ronald. Dispositivo actual: ${origen}]\n` : '';
    const promptDefecto = `Eres Arturo V8.5, el Segundo Cerebro de Ronald. Antes de responder, razona: ¿qué puedes inferir o calcular con estos datos? Luego sintetiza de forma natural. Si guardaste algo, confirma brevemente. Si encontraste recuerdos, conéctalos.`;
    const promptBase = obtenerPrompt('sintetizador_agente.md', promptDefecto);

    // Inyectar historial para que la síntesis tenga contexto
    let bloqueHistorial = '';
    if (historial.length > 0) {
        const lineas = historial.map(m => {
            const quien = m.rol === 'user' ? 'Ronald' : 'Arturo';
            return `[${quien}]: ${m.contenido}`;
        }).join('\n');
        bloqueHistorial = `\nConversación previa:\n${lineas}\n---\n`;
    }

    const prompt = `${promptBase}\n\n${contextoOrigen}${bloqueHistorial}Datos obtenidos por las herramientas:\n"${datosAcumulados.trim()}"\n\nPregunta original de Ronald: "${pregunta}"\n\nRespuesta:`;
    return llamarOllama(prompt, OLLAMA_MODEL_FAST);
}

// ── Inbox: Análisis y Fusión ───────────────────────────────────────────

async function analizarIntenciones(textoNota) {
    const promptDefecto = `Extrae intencion. JSON: {"necesitaWeb":bool,"queryWeb":"txt","topicPrincipal":"txt"}`;
    const promptBase = obtenerPrompt('analizar_intenciones.md', promptDefecto);
    const prompt = `${promptBase}\n\nNOTA: "${textoNota.replace(/"/g, "'").substring(0, 600)}"\nRESULTADO:`;
    try {
        const raw = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
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

module.exports = {
    consultarIAFast,
    orquestarTareas,
    sintetizarRespuestaAgente,
    analizarIntenciones,
    verificarFusion,
};
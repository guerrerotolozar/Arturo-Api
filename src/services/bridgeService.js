const { StateGraph, END, START } = require('@langchain/langgraph');
const { z } = require('zod');
const { ChatOllama } = require('@langchain/ollama');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vectorRepo = require('../repositories/vectorRepository');
const { OLLAMA_MODEL, OLLAMA_URL, VAULT_PATH_BOVEDA } = require('../config/env');
const { enviarNotificacionLocal } = require('../controllers/notificaciones');

// Configuración de LangChain / LangSmith (se leen desde .env)
process.env.LANGCHAIN_TRACING_V2 = process.env.LANGCHAIN_TRACING_V2 || "true";
process.env.LANGCHAIN_ENDPOINT = process.env.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com";
process.env.LANGCHAIN_PROJECT = process.env.LANGCHAIN_PROJECT || "Arturo_Semantic_Bridge";

// ============================================================================
// STATE SCHEMA (LANGGRAPH MEMORY)
// ============================================================================
const bridgeState = {
    payload: {
        value: (x, y) => y ? y : x,
        default: () => ({ notasAnalizadas: [] })
    },
    system_context: {
        value: (x, y) => y ? y : x,
        default: () => ""
    },
    current_note_content: {
        value: (x, y) => y ? y : x,
        default: () => ""
    },
    vector_results: {
        value: (x, y) => y ? y : x,
        default: () => []
    },
    analysis_result: {
        value: (x, y) => y ? y : x,
        default: () => null
    }
};

// ============================================================================
// GRAPH NODES
// ============================================================================

// NODO 1: Recopilar Contexto Dinámico del Sistema
async function fetchSystemContext(state) {
    console.log("[BRIDGE-NODE] fetchSystemContext: Mapeando hardware y stack...");
    let stackInfo = "Desconocido";
    try {
        const pkgPath = path.join(__dirname, '../../package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            stackInfo = `Dependencias clave: ${Object.keys(pkg.dependencies || {}).join(', ')}`;
        }
    } catch (e) {
        console.warn("No se pudo leer package.json", e.message);
    }

    const cpuCores = os.cpus().length;
    const totalRamGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const platform = os.platform();

    const systemContext = `
HARDWARE: Servidor ${platform} con ${cpuCores} núcleos CPU y ${totalRamGB}GB de RAM.
STACK: Node.js API (Segundo Cerebro de Arturo).
TECNOLOGÍAS: ${stackInfo}.
IA ACTIVA: Modelo local ${OLLAMA_MODEL}.
`.trim();

    return { system_context: systemContext };
}

// NODO 2: Cargar la primera nota
async function fetchRecentNotes(state) {
    console.log("[BRIDGE-NODE] fetchRecentNotes: Buscando archivo descargado...");
    const notas = state.payload.notasAnalizadas || [];
    if (notas.length === 0) return { current_note_content: "" };
    
    // Tomamos la última nota analizada
    const rutaNota = path.join(VAULT_PATH_BOVEDA || '', notas[notas.length - 1]);
    let contenido = "";
    if (fs.existsSync(rutaNota)) {
        contenido = fs.readFileSync(rutaNota, 'utf8');
    }
    return { current_note_content: contenido };
}

// NODO 3: Búsqueda Vectorial Pura (Sin Hardcode)
async function vectorSearch(state) {
    console.log("[BRIDGE-NODE] vectorSearch: Buscando contexto semántico global en LanceDB...");
    if (!state.current_note_content) return { vector_results: [] };
    
    // Usamos el título o las primeras líneas de la nota como query
    const tituloMatch = state.current_note_content.match(/^# (.*)/m);
    const query = tituloMatch ? tituloMatch[1] : state.current_note_content.substring(0, 500);

    // Búsqueda global en el RAG (sin filtros estrictos)
    const contextResults = await vectorRepo.buscarSemanticamente(query, 10);
    return { vector_results: contextResults };
}

// NODO 4: LLM Reasoning Dinámico con Zod Transforms
async function llmReasoning(state) {
    console.log("[BRIDGE-NODE] llmReasoning: Evaluando impactos mediante LLM...");
    if (!state.current_note_content) return { analysis_result: null };

    const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
    const llm = new ChatOllama({ baseUrl, model: OLLAMA_MODEL, temperature: 0.1 });

    const prompt = `Actúa como el Analista de Arquitectura e Inteligencia de un Segundo Cerebro.
Tienes acceso total al contexto de nuestro propio servidor, al RAG de conocimiento previo y a un video recién analizado.

CONTEXTO DEL SISTEMA (Tu propio cuerpo):
${state.system_context}

NUEVA INFORMACIÓN (El Estímulo):
${state.current_note_content.substring(0, 3000)}

CONOCIMIENTO PREVIO EN LA BÓVEDA (RAG):
${state.vector_results.length > 0 ? state.vector_results.map(r => r.texto).join('\n\n').substring(0, 3000) : "No hay contexto previo."}

TAREA:
Determina si este nuevo estímulo ofrece una mejora, optimización, herramienta o conocimiento crítico que impacte positivamente a nuestro sistema, a nuestra bóveda de conocimiento (PKM), a nuestros algoritmos o a nuestra infraestructura. No hay límites en el área de impacto (puede ser Node.js, Obsidian, Finanzas, Hardware, etc).

Genera un JSON estrictamente estructurado evaluando el impacto.`;

    // PIPELINE DEFENSIVO 2026: Zod orgánico
    const schemaBridgeAnalysis = z.object({
        impact_score: z.number().describe("De 0 (irrelevante) a 10 (impacto crítico/muy valioso)"),
        action_level: z.enum(["monitor", "review", "action"]),
        findings: z.any().transform(val => {
            if (Array.isArray(val)) return val.map(String);
            if (typeof val === 'string') return [val];
            return ["Sin hallazgos claros"];
        }).describe("Lista de hallazgos relevantes y cómo nos ayudan"),
        areas_impactadas: z.any().transform(val => {
            if (Array.isArray(val)) return val.map(String);
            if (typeof val === 'string') return val.split(',').map(s=>s.trim());
            return [];
        }).describe("Áreas que impacta de forma libre (ej: Gestión de Conocimiento (PKM), Infraestructura Node, Trading, etc)")
    });

    // Función defensiva para normalizar la respuesta de cualquier modelo
    function normalizarBridge(raw) {
        const d = (raw && typeof raw === 'object') ? (raw.bridge_analysis || raw.analisis || raw.analysis || raw) : {};
        const score = Number(d.impact_score !== undefined ? d.impact_score : (d.score !== undefined ? d.score : 0));
        return {
            impact_score: isNaN(score) ? 0 : Math.min(10, Math.max(0, score)),
            action_level: ["monitor", "review", "action"].includes(d.action_level) ? d.action_level : "monitor",
            findings: Array.isArray(d.findings) ? d.findings : (d.findings ? [String(d.findings)] : ["Sin hallazgos claros"]),
            areas_impactadas: Array.isArray(d.areas_impactadas) ? d.areas_impactadas : (d.areas ? [String(d.areas)] : [])
        };
    }

    let analysis;
    try {
        const promptConFormato = `${prompt}

INSTRUCCIONES DE SALIDA:
Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "impact_score": 0,
  "action_level": "monitor",
  "findings": ["hallazgo 1", "hallazgo 2"],
  "areas_impactadas": ["Área 1", "Área 2"]
}
Nota: "impact_score" es un número del 0 al 10. "action_level" debe ser "monitor", "review" o "action".
No agregues texto fuera del JSON.`;

        const respuestaRaw = await llm.invoke(promptConFormato, { format: "json" });
        const texto = typeof respuestaRaw === 'string' ? respuestaRaw : (respuestaRaw.content || '');
        const matchJson = texto.match(/\{[\s\S]*\}/);
        if (!matchJson) {
            throw new Error("No se encontró JSON en respuesta");
        }
        const objetoParsed = JSON.parse(matchJson[0]);
        analysis = schemaBridgeAnalysis.parse(normalizarBridge(objetoParsed));
    } catch (err) {
        console.warn("[BRIDGE-NODE] Error procesando JSON del LLM:", err.message);
        analysis = { impact_score: 0, action_level: "monitor", findings: [], areas_impactadas: [] };
    }

    return { analysis_result: analysis };
}

// ROUTER (Conditional Edge - Threshold = 5)
function routeNotification(state) {
    if (state.analysis_result && state.analysis_result.impact_score >= 5) {
        console.log(`[BRIDGE-ROUTER] Impacto razonable (${state.analysis_result.impact_score} >= 5) detectado. Derivando a Notificaciones.`);
        return "send_notification";
    }
    console.log(`[BRIDGE-ROUTER] Impacto bajo (${state.analysis_result?.impact_score || 0} < 5). Terminando flujo silenciosamente.`);
    return END;
}

// NODO 5: Enviar Notificación
async function sendNotification(state) {
    const analysis = state.analysis_result;
    console.log(`[BRIDGE-NODE] 🚨 Impacto Detectado (${analysis.impact_score}/10) en: ${analysis.areas_impactadas.join(', ')}`);
    
    if (enviarNotificacionLocal) {
        enviarNotificacionLocal({
            titulo: `Bridge: Impacto ${analysis.action_level.toUpperCase()}`,
            mensaje: `Áreas: ${analysis.areas_impactadas.join(', ')}\nImpacto: ${analysis.impact_score}/10\n${analysis.findings[0] || ''}`,
            tipo: 'info'
        });
    }

    return { };
}

// ============================================================================
// GRAPH COMPILATION
// ============================================================================
function buildBridgeGraph() {
    const workflow = new StateGraph({ channels: bridgeState });

    // Añadir nodos
    workflow.addNode("fetch_system_context", fetchSystemContext);
    workflow.addNode("fetch_recent_notes", fetchRecentNotes);
    workflow.addNode("vector_search", vectorSearch);
    workflow.addNode("llm_reasoning", llmReasoning);
    workflow.addNode("send_notification", sendNotification);

    // Definir flujo
    workflow.addEdge(START, "fetch_system_context");
    workflow.addEdge("fetch_system_context", "fetch_recent_notes");
    workflow.addEdge("fetch_recent_notes", "vector_search");
    workflow.addEdge("vector_search", "llm_reasoning");
    
    // Bifurcación condicional
    workflow.addConditionalEdges("llm_reasoning", routeNotification, {
        "send_notification": "send_notification",
        [END]: END
    });
    
    workflow.addEdge("send_notification", END);

    return workflow.compile();
}

async function runSemanticBridge(payload) {
    console.log("[BRIDGE] 🌉 Iniciando Semantic Bridge (LangGraph Orchestration, Dinámico)...");
    const graph = buildBridgeGraph();
    
    try {
        const result = await graph.invoke({ payload: payload });
        console.log("[BRIDGE] ✅ Ejecución del grafo completada.");
        return { status: 'completado', result };
    } catch (err) {
        console.error("[BRIDGE] ❌ Error en LangGraph:", err);
        return { status: 'error', error: err.message };
    }
}

module.exports = { runSemanticBridge };

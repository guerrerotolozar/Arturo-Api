const { ChatOllama } = require("@langchain/ollama");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");
const { ChatPromptTemplate, MessagesPlaceholder } = require("@langchain/core/prompts");
const { toolsList } = require("../tools/langchainTools");
const { OLLAMA_MODEL, OLLAMA_URL } = require("../config/env");
const { buscarSemanticamente, estaDisponible } = require("../repositories/vectorRepository");

// Parsear la URL base de Ollama (ej. http://host.docker.internal:11434)
const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');

const llm = new ChatOllama({
    baseUrl: baseUrl,
    model: OLLAMA_MODEL,
    temperature: 0.1,
});

const prompt = ChatPromptTemplate.fromMessages([
    [
        "system", 
        "Tú eres Arturo (la IA). El usuario con el que hablas es Ronald. Eres un modelo del pasado. Para cualquier pregunta asume que eres un ignorante y DEBES usar tus herramientas para investigar. Nunca adivines. Piensa paso a paso: identifica todas las variables desconocidas en la petición del usuario y usa tus herramientas para resolverlas una por una antes de formular tu respuesta final. Siempre asume contexto geográfico de Colombia (precios en COP).\nLa fecha actual es: {fecha_actual}\n\n{contexto_hibrido}"
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
]);

const agent = createToolCallingAgent({
    llm,
    tools: toolsList,
    prompt,
});

const agentExecutor = new AgentExecutor({
    agent,
    tools: toolsList,
    verbose: false,
});

const { HumanMessage, AIMessage } = require("@langchain/core/messages");

/**
 * Función principal para invocar al agente
 */
async function invocarAgente(pregunta, historial = []) {
    const hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    // 1. Hybrid RAG (Subconsciente Previo)
    let contextoHibrido = "";
    try {
        if (await estaDisponible()) {
            const resultados = await buscarSemanticamente(pregunta, 2, []); // Top 2 chunks
            // Filtrar solo resultados con alta relevancia (distancia baja)
            const resultadosRelevantes = resultados.filter(r => r._distance && r._distance < 0.6);
            if (resultadosRelevantes.length > 0) {
                const chunksText = resultadosRelevantes.map(r => `- [${r.metadata.fuente}]: ${r.texto}`).join('\n');
                contextoHibrido = `RECUERDOS DE TU BOVEDA (USA ESTO SOLO SI ES RELEVANTE PARA LA PREGUNTA):\n${chunksText}`;
                console.log(`[AGENTE] 🧠 Subconsciente inyectado: ${resultadosRelevantes.length} chunks relevantes.`);
            }
        }
    } catch (err) {
        console.warn("[AGENTE] ⚠️ RAG pasivo falló:", err.message);
    }

    // Mapear historial al formato BaseMessage que espera LangChain
    const historyMessages = historial.map(msg => {
        return msg.rol === 'user' ? new HumanMessage(msg.contenido) : new AIMessage(msg.contenido);
    });

    // El streamEvents emitirá todo lo que hace el agente internamente
    const stream = await agentExecutor.streamEvents(
        {
            input: pregunta,
            chat_history: historyMessages,
            fecha_actual: hoy,
            contexto_hibrido: contextoHibrido
        },
        { version: "v2" }
    );

    return stream;
}

module.exports = { invocarAgente };

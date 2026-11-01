/**
 * agentCoreService.js — Lógica central del Agente.
 *
 * Extraída de agent.js (controller) para mantener thin controllers.
 * Responsabilidad: orquestar el procesamiento completo de una petición.
 *
 * Incluye:
 * - Enriquecimiento del prompt (video, imagen, contexto)
 * - Invocación del LangChain Agent
 * - Streaming SSE
 * - Persistencia en SQLite
 * - Función para worker de GPU Queue (background processing)
 */

const fs = require('fs');
const { invocarAgente } = require('../use-cases/langchainAgent');
const { procesarVideo, procesarVideoDesdeRuta } = require('../adapters/videoAdapter');
const { obtenerHistorial, actualizarTitulo, crearChat, guardarMensaje } = require('../repositories/chatRepository');
const { obtenerMediaPorId } = require('../repositories/mediaRepository');
const { buscarResumenMarkdown } = require('../utils/markdownSearcher');

/**
 * Procesa el núcleo de una petición del agente.
 * @param {Object} payload - { pregunta, imagen_b64, video_b64, chatId, media_id }
 * @param {Function} onEstado - Callback para estados intermedios
 * @returns {Promise<Object>} { respuestaLimpia, respuestaId, herramientasActivadas }
 */
async function procesarPeticionCore(payload, onEstado = () => {}) {
    const { pregunta, imagen_b64, video_b64, chatId, media_id } = payload;
    let preguntaEnriquecida = pregunta || '';

    let targetVideoB64 = video_b64;
    let targetImagenB64 = imagen_b64;
    let videoPathLocal = null;

    // Recuperar media local si es necesario
    if (media_id) {
        const mediaItem = obtenerMediaPorId(media_id);
        if (mediaItem) {
            if (mediaItem.tipo.startsWith('video')) {
                videoPathLocal = mediaItem.filepath;
                onEstado('Recuperando video del servidor...');
                console.log(`[MEDIA] Usando video local ID ${media_id}: ${videoPathLocal}`);
            } else if (mediaItem.tipo.startsWith('image')) {
                onEstado('Recuperando imagen del servidor...');
                console.log(`[MEDIA] Usando imagen local ID ${media_id}: ${mediaItem.filepath}`);
                try {
                    targetImagenB64 = fs.readFileSync(mediaItem.filepath).toString('base64');
                } catch (e) {
                    console.warn(`[MEDIA] Error leyendo imagen local: ${e.message}`);
                }
            }
        }
    }

    // Procesar video si hay video
    if (targetVideoB64 || videoPathLocal) {
        let markdownContexto = null;
        if (videoPathLocal) {
            onEstado('Buscando análisis previo del video...');
            markdownContexto = buscarResumenMarkdown(videoPathLocal);
        }

        if (markdownContexto) {
            console.log('[VIDEO] ✔️ Se encontró nota Markdown pre-generada. Omitiendo análisis visual pesado.');
            const contexto = `[EL USUARIO ADJUNTÓ UN VIDEO. EL SISTEMA YA LO HABÍA ANALIZADO EN SEGUNDO PLANO. AQUÍ ESTÁ EL RESUMEN Y TRANSCRIPCIÓN OFICIAL DEL VIDEO:\n\n${markdownContexto}]`;
            preguntaEnriquecida = `${contexto}\nNota para IA: Usa esta nota Markdown adjunta como fuente principal de verdad sobre el video.\n\nPetición de Ronald: ${preguntaEnriquecida || '¿De qué trata este video?'}`;
        } else {
            onEstado('Procesando video visualmente...');
            try {
                let resultado;
                if (videoPathLocal) {
                    resultado = await procesarVideoDesdeRuta(videoPathLocal, onEstado);
                } else {
                    resultado = await procesarVideo(targetVideoB64, onEstado);
                }

                let contexto = '';
                if (resultado.contextoVisual) {
                    contexto += `[EL USUARIO ADJUNTÓ UN VIDEO. AQUÍ ESTÁ EL ANÁLISIS VISUAL:\n${resultado.contextoVisual}]`;
                }
                if (resultado.transcripcion) {
                    contexto += `[AUDIO/DIÁLOGO DEL VIDEO ADJUNTO:\n${resultado.transcripcion}]`;
                }

                preguntaEnriquecida = contexto
                    ? `${contexto}\nNota para IA: El video ya fue procesado y analizado.\n\nPetición de Ronald: ${preguntaEnriquecida || '¿De qué trata este video?'}`
                    : preguntaEnriquecida;
            } catch (videoErr) {
                onEstado('Error procesando video, continuando sin contexto visual...');
            }
        }
    }

    // Obtener historial de chat
    let historial = [];
    if (chatId) {
        historial = obtenerHistorial(chatId, 10);
    }

    // Invocar agente con LangChain
    const stream = await invocarAgente(preguntaEnriquecida, historial);

    let respuestaLimpia = '';
    let herramientasActivadas = [];

    // Consumir stream con chunks SSE
    for await (const event of stream) {
        if (event.event === 'on_chat_model_stream') {
            const chunk = event.data.chunk?.content;
            if (chunk && typeof chunk === 'string') {
                respuestaLimpia += chunk;
            }
        } else if (event.event === 'on_tool_start') {
            const toolName = event.name;
            herramientasActivadas.push(toolName);
            onEstado(`Usando: ${toolName}...`);
        }
    }

    // Generar ID de respuesta
    const respuestaId = chatId || `chat_${Date.now()}`;

    // Persistir en SQLite
    try {
        crearChat(respuestaId);
        guardarMensaje(respuestaId, 'user', pregunta || '(imagen/video)');
        guardarMensaje(respuestaId, 'assistant', respuestaLimpia);
        const hist = obtenerHistorial(respuestaId, 2);
        if (hist.length <= 2 && pregunta) {
            const titulo = pregunta.substring(0, 40) + (pregunta.length > 40 ? '...' : '');
            actualizarTitulo(respuestaId, titulo);
        }
    } catch (memErr) {
        console.warn(`[MEMORIA] Error al guardar: ${memErr.message}`);
    }

    return { respuestaLimpia, respuestaId, herramientasActivadas };
}

/**
 * Función expuesta para el worker del GPU Queue (background processing).
 * @param {Object} payload - Payload de la petición
 * @returns {Promise<Object>} Resultado del procesamiento
 */
async function ejecutarChatEncolado(payload) {
    console.log(`[AGENTE ENCOLADO] Procesando chat de background...`);
    const { respuestaLimpia, respuestaId } = await procesarPeticionCore(payload, (estado) => {
        console.log(`[AGENTE ENCOLADO] Estado: ${estado}`);
    });

    return { success: true, respuestaId, preview: respuestaLimpia.substring(0, 50) };
}

module.exports = {
    procesarPeticionCore,
    ejecutarChatEncolado
};

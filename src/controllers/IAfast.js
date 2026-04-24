/**
 * src/controllers/IAfast.js — Solo HTTP.
 *
 * Antes: ~100 líneas con lógica de herramientas, if/else, prompts, LLM directo.
 * Ahora: validar → delegar al use-case → serializar respuesta.
 *
 * v6.2: Pre-procesamiento proactivo de imágenes (Base64 desde la app Android).
 *       Si llega imagen, se analiza con Vision ANTES de orquestar herramientas.
 */

const { ejecutarAgenteRapido } = require('../use-cases/agenteRapidoUseCase');
const { analizarImagen } = require('../adapters/visionAdapter');
const { OLLAMA_MODEL_FAST } = require('../config/env');
const { guardarMensaje, obtenerHistorial, actualizarTitulo, crearChat } = require('../repositories/chatRepository');

async function consultaIAFast(req, res) {
    const { pregunta, origen, imagen_b64, chatId } = req.body;
    if (!pregunta && !imagen_b64) return res.status(400).json({ error: 'Falta la pregunta o imagen.' });

    const etiquetaOrigen = origen ? `Ronald/${origen}` : 'AGENTE';
    console.log(`\n[${etiquetaOrigen}] Peticion: "${pregunta || '(imagen sin texto)'}"`);

    try {
        const tGlobal = Date.now();
        let tStep = Date.now();
        const tick = () => { const elapsed = ((Date.now() - tStep) / 1000).toFixed(2); tStep = Date.now(); return `[ ${elapsed}s ]`; };

        // v6.2: Iniciar Streaming SSE (Server-Sent Events)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const enviarEstado = (mensaje) => {
            res.write(`data: ${JSON.stringify({ tipo: 'estado', texto: mensaje })}\n\n`);
        };

        // Mantener la conexión HTTP viva eviando un comentario en blanco cada 15s.
        // Esto reinicia el contador de Retrofit en Android evitando desconexiones.
        const keepAliveInterval = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        // ── Pre-procesamiento proactivo de imagen ──
        let preguntaEnriquecida = pregunta || '';

        try {
            if (imagen_b64) {
                enviarEstado('Analizando imagen...');
                console.log(`[VISION PRE] Imagen recibida (${Math.round(imagen_b64.length / 1024)} KB b64). Analizando...`);
                try {
                    const vision = await analizarImagen(imagen_b64, null);
                    const contextoVisual = vision.texto;
                    console.log(`[VISION PRE] Extraído ✔️ ${tick()}`);

                    preguntaEnriquecida = preguntaEnriquecida
                        ? `[CONTEXTO VISUAL de imagen adjunta: ${contextoVisual}]\n\nPetición de Ronald: ${preguntaEnriquecida}`
                        : `Analiza lo siguiente extraído de una imagen: ${contextoVisual}`;
                } catch (visionErr) {
                    console.warn(`[VISION PRE] Fallo en pre-procesamiento: ${visionErr.message} ${tick()}`);
                }
            }

            // ── Recuperar historial si hay chatId ──
            let historial = [];
            if (chatId) {
                historial = obtenerHistorial(chatId, 10);
                if (historial.length > 0) {
                    console.log(`[MEMORIA] Chat ${chatId}: ${historial.length} mensajes previos cargados`);
                }
            }

            const resultado = await ejecutarAgenteRapido(preguntaEnriquecida, origen, enviarEstado, historial);
            console.log(`[AGENTE] Ejecución total Agente ✔️ ${tick()}`);

            const respuestaId = chatId || `chat_${Date.now()}`;

            res.write(`data: ${JSON.stringify({
                tipo: 'final',
                pregunta: pregunta || '(imagen)',
                respuesta:              resultado.respuesta,
                motor_usado:            `${OLLAMA_MODEL_FAST} (Modo Agente)`,
                herramientas_activadas: resultado.herramientas,
                plan_interno:           resultado.plan,
                chatId:                 respuestaId
            })}\n\n`);

            // ── Persistir la conversación ──
            if (chatId || true) { // Siempre guardar para que el historial esté disponible
                try {
                    crearChat(respuestaId);
                    guardarMensaje(respuestaId, 'user', pregunta || '(imagen)');
                    guardarMensaje(respuestaId, 'assistant', resultado.respuesta);
                    // Auto-título: si es el primer mensaje, usar los primeros 40 chars
                    const hist = obtenerHistorial(respuestaId, 2);
                    if (hist.length <= 2 && pregunta) {
                        const titulo = pregunta.substring(0, 40) + (pregunta.length > 40 ? '...' : '');
                        actualizarTitulo(respuestaId, titulo);
                    }
                } catch (memErr) {
                    console.warn(`[MEMORIA] Error al guardar: ${memErr.message}`);
                }
            }
            
            res.end();
            console.log(`[SERVIDOR] Flujo completo /IA/fast ✔️ [ ${((Date.now() - tGlobal)/1000).toFixed(2)}s ]`);
        } finally {
            clearInterval(keepAliveInterval);
        }

    } catch (err) {
        console.error(`[AGENTE ERROR] ${err.message}`);
        // Si ya mandamos cabeceras SSE, devolvemos error en formato evento
        res.write(`data: ${JSON.stringify({ tipo: 'error', texto: err.message })}\n\n`);
        res.end();
    }
}

module.exports = consultaIAFast;
/**
 * src/controllers/agent.js — Controlador HTTP del Agente Rápido.
 *
 * Responsabilidad: validar → delegar al service → serializar respuesta SSE.
 * Soporta: texto, imágenes (Base64), video (Base64 o media_id local).
 *
 * v10: Extraída la lógica pesada a agentCoreService.js.
 * Este archivo es un thin controller (Thin Controller Pattern).
 */

const { procesarPeticionCore } = require('../services/agentCoreService');

async function consultaIAFast(req, res) {
    const { pregunta, origen, imagen_b64, video_b64, chatId, media_id } = req.body;
    if (!pregunta && !imagen_b64 && !video_b64 && !media_id) return res.status(400).json({ error: 'Falta la pregunta, imagen, video o media_id.' });

    const etiquetaOrigen = origen ? `Ronald/${origen}` : 'AGENTE';
    console.log(`\n[${etiquetaOrigen}] Peticion: "${pregunta || '(imagen sin texto)'}"`);

    // Check GPU Status First
    const gpuMonitor = require('../services/gpuMonitorService');
    if (gpuMonitor.isGpuBusy()) {
        console.log(`[AGENTE] ⏸️ GPU ocupada. Petición encolada para chat ${chatId || 'nuevo'}`);
        const gpuQueue = require('../services/gpuQueueService');
        gpuQueue.enqueue('agent_chat', 1, { pregunta, origen, imagen_b64, video_b64, chatId, media_id });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const respuestaId = chatId || `chat_${Date.now()}`;
        res.write(`data: ${JSON.stringify({ tipo: 'estado', texto: 'GPU Ocupada. Encolando...' })}\n\n`);
        res.write(`data: ${JSON.stringify({
            tipo: 'final',
            pregunta: pregunta || '(imagen)',
            respuesta: "⏳ *La GPU está actualmente al máximo de su capacidad* (probablemente por entrenamiento o gaming pesado). Tu mensaje ha sido puesto en la cola prioritaria. Lo procesaré en segundo plano tan pronto se liberen recursos.",
            motor_usado: "Sistema (GPU Queue)",
            herramientas_activadas: [],
            plan_interno: "GPU Queue",
            chatId: respuestaId
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ tipo: 'hecho' })}\n\n`);
        res.end();
        return;
    }

    try {
        const tGlobal = Date.now();
        let tStep = Date.now();
        const tick = () => { const elapsed = ((Date.now() - tStep) / 1000).toFixed(2); tStep = Date.now(); return `[ ${elapsed}s ]`; };

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const enviarEstado = (mensaje) => {
            res.write(`data: ${JSON.stringify({ tipo: 'estado', texto: mensaje })}\n\n`);
        };

        const keepAliveInterval = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        try {
            const { respuestaLimpia, respuestaId, herramientasActivadas } = await procesarPeticionCore(
                { pregunta, origen, imagen_b64, video_b64, chatId, media_id },
                enviarEstado
            );

            console.log(`[AGENTE] Ejecución total LangChain ✔️ ${tick()}`);

            res.write(`data: ${JSON.stringify({
                tipo: 'final',
                pregunta: pregunta || '(imagen)',
                respuesta: respuestaLimpia,
                motor_usado: 'gemma4:12b (LangChain)',
                herramientas_activadas: herramientasActivadas,
                plan_interno: "LangChain AgentExecutor",
                chatId: respuestaId
            })}\n\n`);

            clearInterval(keepAliveInterval);
            console.log(`\n[SERVIDOR] Flujo completo /api/agent/chat ✔️ [ ${((Date.now() - tGlobal)/1000).toFixed(2)}s ]`);
            res.write(`data: ${JSON.stringify({ tipo: 'hecho' })}\n\n`);
            res.end();
        } catch (err) {
            clearInterval(keepAliveInterval);
            throw err;
        }

    } catch (err) {
        console.error(`\n[AGENTE ERROR] ${err.message}`);
        if (!res.headersSent || res.getHeader('Content-Type') === 'text/event-stream') {
            res.write(`data: ${JSON.stringify({ tipo: 'error', error: err.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = consultaIAFast;

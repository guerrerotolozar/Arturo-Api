/**
 * src/controllers/bot.js
 * 
 * Controlador para las inferencias del Bot de Trading.
 * Si es horario trader, hace bypass a Ollama. Si no lo es, encola la tarea en GPU_QUEUE.
 */

const gpuQueue = require('../services/gpuQueueService');

async function doOllamaInference(prompt, model = "gemma4:12b-it-qat") {
    // LLamada directa a Ollama nativo en el Host
    const response = await fetch('http://host.docker.internal:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.15
            }
        })
    });
    
    if (!response.ok) {
        throw new Error(`Ollama Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.response;
}

// Endpoint POST /api/bot/inference
async function botInferenceController(req, res) {
    const { prompt, model } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Falta el prompt' });
    }

    try {
        console.log('[BOT_GATEWAY] Encolando petición al Smart GPU Queue...');
        const taskId = gpuQueue.enqueue('bot_inference', null, { prompt, model });
        
        // Esperar a que el worker la procese (max 2 horas = 7200000 ms para soportar videos de 70+ mins)
        const result = await gpuQueue.waitForTaskCompletion(taskId, 7200000);
        console.log(`[BOT_GATEWAY] ✅ Tarea ${taskId} completada. Devolviendo al bot.`);
        return res.json({ result });
    } catch (err) {
        console.error('[BOT_GATEWAY] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}

// Función expuesta para el worker del Queue
async function ejecutarInferenciaBot(payload) {
    console.log(`[BOT_ENCOLADO] Procesando inferencia...`);
    const { prompt, model } = payload;
    const result = await doOllamaInference(prompt, model);
    return result;
}

module.exports = {
    botInferenceController,
    ejecutarInferenciaBot
};

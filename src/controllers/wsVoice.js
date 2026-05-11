/**
 * wsVoice.js — WebSocket server para la app móvil.
 * Protocolo:
 *   Celular → servidor: { tipo: 'audio', data: '<base64 WAV>' }
 *   Servidor → celular: { tipo: 'respuesta', texto: '...', audio: '<base64 WAV>' }
 *
 * Para integrar en index.js:
 *   const { iniciarWSVoz } = require('./src/controllers/wsVoice');
 *   iniciarWSVoz(server); // donde server = app.listen(...)
 */
const WebSocket           = require('ws');
const { transcribirAudio }      = require('../adapters/whisperAdapter');
const { sintetizarVoz }         = require('../adapters/piperAdapter');
const { ejecutarAgenteRapido }  = require('../use-cases/agenteRapidoUseCase');

function iniciarWSVoz(httpServer) {
    const wss = new WebSocket.Server({ server: httpServer, path: '/ws/voice' });

    wss.on('connection', (ws, req) => {
        console.log(`[WS] Cliente conectado: ${req.socket.remoteAddress}`);

        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.tipo !== 'audio') return;

                // 1. STT
                const audioBuffer = Buffer.from(msg.data, 'base64');
                ws.send(JSON.stringify({ tipo: 'estado', texto: 'Transcribiendo...' }));
                const transcripcion = await transcribirAudio(audioBuffer);
                console.log(`[WS] Transcripción: "${transcripcion}"`);

                ws.send(JSON.stringify({ tipo: 'transcripcion', texto: transcripcion }));

                // 2. Agente procesa
                ws.send(JSON.stringify({ tipo: 'estado', texto: 'Pensando...' }));
                const resultado = await ejecutarAgenteRapido(transcripcion);

                // 3. TTS
                ws.send(JSON.stringify({ tipo: 'estado', texto: 'Generando respuesta...' }));
                const audioRespuesta = await sintetizarVoz(resultado.respuesta);

                // 4. Enviar todo al celular
                ws.send(JSON.stringify({
                    tipo:        'respuesta',
                    texto:       resultado.respuesta,
                    herramientas: resultado.herramientas,
                    audio:       audioRespuesta.toString('base64')  // el celular reproduce esto
                }));

            } catch (err) {
                console.error(`[WS ERROR] ${err.message}`);
                ws.send(JSON.stringify({ tipo: 'error', mensaje: err.message }));
            }
        });

        ws.on('close', () => console.log('[WS] Cliente desconectado'));
    });
}

module.exports = { iniciarWSVoz };
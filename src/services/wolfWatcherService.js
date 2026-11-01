/**
 * src/services/wolfWatcherService.js
 * 
 * Escucha el socket de Docker para interceptar la creación de contenedores "Esclavos" de Wolf.
 * Si detecta que estás intentando jugar durante el Horario Trader, bloquea el juego (kill al contenedor)
 * y manda una notificación Push al celular.
 */

const http = require('http');
const { enviarNotificacionLocal } = require('../controllers/notificaciones');

// Helper para comandos HTTP a Docker
function dockerRequest(path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'docker-proxy',
            port: 2375,
            path: path,
            method: method,
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304) {
                    try { resolve(data ? JSON.parse(data) : true); } catch (e) { resolve(true); }
                } else {
                    reject(new Error(`Docker API Error: ${res.statusCode} - ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

const { isTradingHours } = require('../utils/timeUtils');

async function handleWolfSpawn(name, id) {
    if (isTradingHours()) {
        console.log(`[WOLF_WATCHER] ⛔ INTENTO DE JUEGO DETECTADO EN HORARIO TRADER: ${name}`);
        try {
            // Asesinar al esclavo instantáneamente
            await dockerRequest(`/v1.41/containers/${id}/kill`, 'POST');
            await dockerRequest(`/v1.41/containers/${id}?force=true`, 'DELETE');
            
            console.log(`[WOLF_WATCHER] 🛑 Esclavo ${name} bloqueado y eliminado.`);
            
            // Disparar Notificación Push
            if (enviarNotificacionLocal) {
                enviarNotificacionLocal({
                    titulo: 'Juego Bloqueado',
                    mensaje: 'Aún estamos en horario trader, espérame.',
                    tipo: 'alerta'
                });
            }
        } catch(e) {
            console.error(`[WOLF_WATCHER] Error bloqueando juego:`, e.message);
        }
    } else {
        console.log(`[WOLF_WATCHER] 🎮 Juego permitido fuera de horario. Esclavo vivo: ${name}`);
        // No hacemos nada, dejamos que la VRAM suba y la GPU_QUEUE se pause sola.
    }
}

function iniciarWolfWatcher() {
    console.log('[WOLF_WATCHER] 👀 Iniciando vigilante autónomo de juegos (Docker Events)...');
    
    const options = {
        hostname: 'docker-proxy',
        port: 2375,
        path: '/v1.41/events?filters=' + encodeURIComponent(JSON.stringify({ type: ['container'], event: ['start', 'die'] })),
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
                try {
                    const event = JSON.parse(line);
                    if (event.Actor && event.Actor.Attributes && event.Actor.Attributes.name) {
                        const name = event.Actor.Attributes.name;
                        const id = event.id || event.Actor.ID;
                        
                        // Ignorar al cerebro principal
                        if (name.includes('Wolf') && !name.includes('wolf-gaming')) {
                            
                            if (event.status === 'start') {
                                handleWolfSpawn(name, id);
                            } 
                            else if (event.status === 'die') {
                                // Limpieza automática de zombies
                                console.log(`[WOLF_WATCHER] 🧹 Esclavo terminó: ${name}. Limpiando contenedor zombie...`);
                                // dockerRequest(`/v1.41/containers/${id}?force=true&v=true`, 'DELETE')
                                //     .catch(err => {
                                //         // Ignorar si Wolf ya lo borró por su cuenta
                                //     });
                            }
                        }
                    }
                } catch(e) {
                    // Ignorar errores de parseo por chunks incompletos
                }
            }
        });
        
        res.on('end', () => {
            console.warn('[WOLF_WATCHER] Conexión de eventos cerrada. Reconectando en 5s...');
            setTimeout(iniciarWolfWatcher, 5000);
        });
    });
    
    req.on('error', (e) => {
        console.error('[WOLF_WATCHER] Error en Docker socket:', e.message);
        setTimeout(iniciarWolfWatcher, 5000);
    });
    
    req.end();
}

module.exports = {
    iniciarWolfWatcher
};

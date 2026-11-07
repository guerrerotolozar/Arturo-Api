/**
 * src/services/cerebroWatcherService.js
 *
 * Implementa un File Watcher (Chokidar) para observar cambios en tiempo real
 * en el Segundo Cerebro (Obsidian).
 *
 * Si un archivo se modifica, crea, o elimina, se programa una sincronización
 * de LanceDB con un debounce para no sobrecargar el sistema en caso de
 * escrituras masivas (ej. git pull o SyncThing bajando muchos archivos).
 */

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { VAULT_PATH_BOVEDA } = require('../config/env');

let syncTimeout = null;
const SYNC_DEBOUNCE_MS = 5000; // Esperar 5 segundos tras el último cambio antes de sincronizar

const { enqueue, hasPendingTaskOfType } = require('./gpuQueueService');

/**
 * Función debounce para agrupar múltiples eventos de archivo
 * en una sola sincronización vectorial.
 */
function programarSincronizacion() {
    if (syncTimeout) {
        clearTimeout(syncTimeout);
    }
    
    syncTimeout = setTimeout(() => {
        try {
            if (!hasPendingTaskOfType('vault_sync')) {
                enqueue('vault_sync', 3, { forzarReset: false });
                console.log('[WATCHER] Cambios detectados. Tarea de sincronización enviada a la cola de GPU (Prioridad 3).');
            }
        } catch (error) {
            console.error('[WATCHER] Error al encolar sincronización:', error.message);
        }
    }, SYNC_DEBOUNCE_MS);
}

function iniciarWatcherCerebro() {
    if (!VAULT_PATH_BOVEDA || !fs.existsSync(VAULT_PATH_BOVEDA)) {
        console.warn(`[WATCHER] Ruta de bóveda no existe: ${VAULT_PATH_BOVEDA}. No se inicia el watcher.`);
        return;
    }

    // Inicializamos chokidar
    // ignoreInitial: true para no disparar eventos por los archivos que ya existen al arrancar
    const ignoredDirs = new Set(['BotTrading', 'Boveda', 'Boveda_AI', 'vault-template', 'vault', 'node_modules']);
    const watcher = chokidar.watch(VAULT_PATH_BOVEDA, {
        ignored: (targetPath) => {
            const rel = path.relative(VAULT_PATH_BOVEDA, targetPath);
            if (!rel || rel === '') return false; // nunca ignorar la raíz VAULT_PATH_BOVEDA
            if (rel.includes('Bitacora_Ordenes_OasisStore') || rel.includes('Mapa_Directorios_y_Espacio_Servidor')) return true;
            const parts = rel.split(/[/\\]/);
            return parts.some(p => p.startsWith('.') || ignoredDirs.has(p));
        },
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
        }
    });

    watcher
        .on('add', (filePath) => {
            if (filePath.endsWith('.md')) {
                console.log(`[WATCHER] Archivo añadido: ${path.basename(filePath)}`);
                programarSincronizacion();
            }
        })
        .on('change', (filePath) => {
            if (filePath.endsWith('.md')) {
                // Syncthing puede tocar archivos sin cambiar contenido, pero sincronizarBoveda lo resolverá por mtime
                programarSincronizacion();
            }
        })
        .on('unlink', (filePath) => {
            if (filePath.endsWith('.md')) {
                console.log(`[WATCHER] Archivo eliminado: ${path.basename(filePath)}`);
                programarSincronizacion();
            }
        })
        .on('error', error => console.log(`[WATCHER] Error: ${error}`));
}

module.exports = {
    iniciarWatcherCerebro
};

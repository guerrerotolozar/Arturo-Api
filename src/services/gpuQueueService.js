const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { GPU_QUEUE_CHECK_INTERVAL_MS } = require('../config/env');
const { isTradingHours } = require('../utils/timeUtils');

const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'gpu_queue.db');
let db;

function initDb() {
    if (db) return; // Ya inicializada
    db = new Database(dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS gpu_task_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payload TEXT,
            result TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME
        )
    `);
}

function calculateDynamicPriority(type, payloadObj) {
    const isTrading = isTradingHours();
    if (type === 'bot_inference') {
        return isTrading ? 0 : 2;
    }
    if (type === 'agent_chat') {
        return isTrading ? 1 : 0;
    }
    if (type === 'media_analysis') return 2;
    if (type === 'concept_refactor') return 3;
    if (type === 'semantic_bridge') return 3;
    if (type === 'vault_sync') return 3;
    if (type === 'vigilante_curation') return 4;
    return 5;
}

function enqueue(type, priority, payloadObj) {
    if (!db) initDb();
    
    // Si la prioridad es nula, calcularla dinámicamente según las reglas
    const finalPriority = (priority === null || priority === undefined) 
        ? calculateDynamicPriority(type, payloadObj) 
        : priority;

    const stmt = db.prepare(`INSERT INTO gpu_task_queue (type, priority, payload) VALUES (?, ?, ?)`);
    const info = stmt.run(type, finalPriority, JSON.stringify(payloadObj));
    console.log(`[GPU_QUEUE] 📥 Tarea encolada. ID: ${info.lastInsertRowid}, Tipo: ${type}, Prioridad: ${finalPriority}`);
    
    // Disparador Event-Driven instantáneo
    setTimeout(processQueueTick, 0);
    
    return info.lastInsertRowid;
}

function dequeue() {
    if (!db) initDb();
    
    const isTrading = isTradingHours();
    let query = `
        SELECT * FROM gpu_task_queue 
        WHERE status = 'pending' 
    `;
    
    if (isTrading) {
        query += ` AND type != 'media_analysis' `;
    }
    
    query += ` ORDER BY priority ASC, created_at ASC LIMIT 1`;
    
    const stmt = db.prepare(query);
    const task = stmt.get();
    if (task && task.payload) {
        task.payload = JSON.parse(task.payload);
    }
    return task;
}

function markRunning(taskId) {
    if (!db) initDb();
    db.prepare(`UPDATE gpu_task_queue SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
}

function markCompleted(taskId, resultObj) {
    if (!db) initDb();
    db.prepare(`UPDATE gpu_task_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP, result = ? WHERE id = ?`)
      .run(JSON.stringify(resultObj), taskId);
}

function markFailed(taskId, errorStr) {
    if (!db) initDb();
    db.prepare(`UPDATE gpu_task_queue SET status = 'failed', completed_at = CURRENT_TIMESTAMP, result = ? WHERE id = ?`)
      .run(JSON.stringify({ error: errorStr }), taskId);
}

function getQueueStatus() {
    if (!db) initDb();
    const pending = db.prepare(`SELECT count(*) as c FROM gpu_task_queue WHERE status = 'pending'`).get().c;
    const running = db.prepare(`SELECT count(*) as c FROM gpu_task_queue WHERE status = 'running'`).get().c;
    const total = db.prepare(`SELECT count(*) as c FROM gpu_task_queue`).get().c;
    return { pending, running, total };
}

function hasPendingTaskOfType(type) {
    if (!db) initDb();
    const count = db.prepare(`SELECT count(*) as c FROM gpu_task_queue WHERE status = 'pending' AND type = ?`).get(type).c;
    return count > 0;
}

// Estado del worker
let workerInterval = null;
let lastCheckTime = Date.now();
let isProcessing = false;

async function processQueueTick() {
    if (isProcessing) return;
    if (!db) initDb();

    isProcessing = true;
    try {
        while (true) {
            const status = getQueueStatus();
            if (status.pending === 0) {
                lastCheckTime = Date.now();
                break; // Cola vacía
            }

            const gpuMonitor = require('./gpuMonitorService');
            if (gpuMonitor.isGpuBusy()) {
                break; // GPU ocupada (Wolf Gaming / etc.), detener loop
            }

            const task = dequeue();
            if (!task) break;

            console.log(`[GPU_QUEUE] ▶️ Ejecutando tarea ${task.id} (${task.type}) con prioridad ${task.priority}...`);
            markRunning(task.id);
            lastCheckTime = Date.now();

            try {
                if (task.type === 'media_analysis') {
                    const { ejecutarAnalisisEncolado } = require('./mediaAnalysisService');
                    const result = await ejecutarAnalisisEncolado(task.payload);
                    markCompleted(task.id, result);
                } else if (task.type === 'agent_chat') {
                    const { ejecutarChatEncolado } = require('./agentCoreService');
                    const result = await ejecutarChatEncolado(task.payload);
                    markCompleted(task.id, result);
                } else if (task.type === 'vault_sync') {
                    const { sincronizarBoveda } = require('../use-cases/vaultIndexer');
                    const result = await sincronizarBoveda(task.payload || { forzarReset: false, onProgress: () => {} });
                    markCompleted(task.id, result);
                } else if (task.type === 'vigilante_curation') {
                    const { ejecutarCuraduriaEncolada } = require('./vigilanteService');
                    const result = await ejecutarCuraduriaEncolada();
                    markCompleted(task.id, result || { status: 'completado' });
                } else if (task.type === 'concept_refactor') {
                    const { ejecutarRefundicionConcepto } = require('./vigilanteService');
                    const result = await ejecutarRefundicionConcepto(task.payload);
                    markCompleted(task.id, result || { status: 'completado' });
                } else if (task.type === 'semantic_bridge') {
                    const { runSemanticBridge } = require('./bridgeService');
                    const result = await runSemanticBridge(task.payload);
                    markCompleted(task.id, result);
                } else if (task.type === 'bot_inference') {
                    const { ejecutarInferenciaBot } = require('../controllers/bot');
                    const result = await ejecutarInferenciaBot(task.payload);
                    markCompleted(task.id, result);
                } else {
                    markFailed(task.id, `Tipo de tarea desconocido: ${task.type}`);
                }
            } catch (err) {
                console.error(`[GPU_QUEUE] ❌ Error en tarea ${task.id}:`, err);
                markFailed(task.id, err.message);
            }
        }
    } catch (error) {
        console.error(`[GPU_QUEUE] ❌ Error inesperado en el worker loop:`, error);
    } finally {
        isProcessing = false;
    }
}

function iniciarWorker() {
    if (workerInterval) return;
    if (!db) initDb();

    console.log(`[GPU_QUEUE] 👷 Worker iniciado (Event-Driven). Revisión de fallback cada ${GPU_QUEUE_CHECK_INTERVAL_MS}ms`);
    workerInterval = setInterval(processQueueTick, GPU_QUEUE_CHECK_INTERVAL_MS);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function waitForTaskCompletion(taskId, maxWaitMs = 120000) {
    if (!db) initDb();
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        const stmt = db.prepare(`SELECT status, result FROM gpu_task_queue WHERE id = ?`);
        const task = stmt.get(taskId);
        if (!task) throw new Error("Task not found");

        if (task.status === 'completed') {
            return task.result ? JSON.parse(task.result) : null;
        } else if (task.status === 'failed') {
            const res = task.result ? JSON.parse(task.result) : {};
            throw new Error(res.error || "Task failed");
        }
        await delay(2000);
    }
    throw new Error("Task timed out waiting in queue");
}

module.exports = {
    enqueue,
    dequeue,
    getQueueStatus,
    hasPendingTaskOfType,
    iniciarWorker,
    markCompleted,
    markFailed,
    waitForTaskCompletion,
    get lastCheckTime() { return lastCheckTime; }
};

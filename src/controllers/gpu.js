const gpuMonitor = require('../services/gpuMonitorService');
const gpuQueue = require('../services/gpuQueueService');

function gpuStatusController(req, res) {
    try {
        const stats = gpuMonitor.getGpuStats();
        const isBusy = gpuMonitor.isGpuBusy();
        
        let modo = 'idle';
        if (isBusy) {
            if (stats.vramUsedMB > 12000) {
                modo = 'training/gaming (heavy load)';
            } else {
                modo = 'compute_intensive';
            }
        } else if (stats.vramUsedMB > 6000) {
            modo = 'ollama_ready';
        }

        res.json({
            success: true,
            status: isBusy ? 'BUSY' : 'AVAILABLE',
            modo_detectado: modo,
            stats: {
                vramUsedMB: stats.vramUsedMB,
                gpuUtilPercent: stats.gpuUtilPercent
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

function gpuQueueController(req, res) {
    try {
        const queueStats = gpuQueue.getQueueStatus();
        res.json({
            success: true,
            queue: queueStats
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}

module.exports = {
    gpuStatusController,
    gpuQueueController
};

/**
 * gpuMonitorService.js — Monitoreo de GPU.
 *
 * Usa nvidia-smi para verificar si la GPU está libre o ocupada.
 * Compatible con Docker (nvidia-smi está disponible via nvidia-container-toolkit).
 *
 * Fallback: si nvidia-smi no está disponible, asume que la GPU está libre
 * (para desarrollo en Windows/Mac o si el driver no está instalado).
 */

const { execSync } = require('child_process');
const { GPU_VRAM_THRESHOLD_MB, GPU_UTIL_THRESHOLD_PCT } = require('../config/env');

let cachedStats = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5000;

function parseSmiOutput(output) {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return null;
    // La línea de cabecera es la primera, los datos comienzan en la segunda
    const dataLine = lines[1];
    const values = dataLine.split(',').map(s => {
        const cleaned = s.trim().replace(/[^0-9]/g, '');
        return parseInt(cleaned, 10);
    });
    return {
        vramUsedMB: values[0] || 0,
        gpuUtilPercent: values[1] || 0
    };
}

function getGpuStats() {
    const now = Date.now();
    if (cachedStats && (now - lastCheckTime < CACHE_TTL_MS)) {
        return cachedStats;
    }

    try {
        // nvidia-smi en Docker requiere nvidia-container-toolkit
        // Si no está disponible, devolvemos stats defaults (GPU libre)
        const output = execSync('nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        const stats = parseSmiOutput(output);
        if (stats) {
            cachedStats = stats;
            lastCheckTime = now;
            return stats;
        }
    } catch (e) {
        // En desarrollo, Docker sin nvidia-smi, o sin NVIDIA: asumimos libre
        console.warn('[GPU_MONITOR] nvidia-smi no disponible. Asumiendo GPU libre.');
        cachedStats = { vramUsedMB: 0, gpuUtilPercent: 0 };
        lastCheckTime = now;
        return cachedStats;
    }

    return { vramUsedMB: 0, gpuUtilPercent: 0 };
}

function isGpuBusy() {
    const stats = getGpuStats();
    if (stats.vramUsedMB > GPU_VRAM_THRESHOLD_MB || stats.gpuUtilPercent > GPU_UTIL_THRESHOLD_PCT) {
        return true;
    }
    return false;
}

function isGpuAvailableForOllama() {
    return !isGpuBusy();
}

module.exports = {
    getGpuStats,
    isGpuBusy,
    isGpuAvailableForOllama
};

const { execSync } = require('child_process');

/**
 * Obtiene el estado de los procesos gestionados por PM2.
 * @returns {string} Resumen de procesos activos
 */
function obtenerEstadoPm2() {
    try {
        const pm2Status = execSync('pm2 jlist', { encoding: 'utf-8' });
        const processes = JSON.parse(pm2Status);
        const active = processes.map(p => `- **${p.name}**: ${p.pm2_env.status} (Mem: ${(p.monit.memory / 1024 / 1024).toFixed(1)}MB)`).join('\n');
        return `Estado de servicios PM2:\n${active}`;
    } catch (e) {
        return 'No se pudo obtener el estado de PM2. ¿Está instalado y accesible para el usuario actual?';
    }
}

module.exports = { obtenerEstadoPm2 };

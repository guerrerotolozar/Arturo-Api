const os = require('os');
const { execSync } = require('child_process');

/**
 * obtenerSaludServidorUseCase.js
 * 
 * Devuelve ÚNICAMENTE datos dinámicos en tiempo real del hardware.
 * La información estática (Specs, TDP, PSU) debe vivir en el Cerebro (Vault).
 */

function obtenerSaludServidor() {
    try {
        const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
        const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
        const usedMem = (totalMem - freeMem).toFixed(2);
        const memPercentage = ((usedMem / totalMem) * 100).toFixed(1);

        const cpus = os.cpus();
        const cpuModel = cpus[0].model;
        const cpuCores = cpus.length;
        const loadAvg = os.loadavg().map(load => load.toFixed(2)).join(', ');

        const uptimeSeconds = os.uptime();
        const uptimeDays = Math.floor(uptimeSeconds / (3600 * 24));
        const uptimeHours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
        const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

        let diskInfo = 'No disponible';
        try {
            // Ajustado para Ubuntu Server
            const dfOutput = execSync("df -h / | awk 'NR==2 {print \"Total: \"$2\", Usado: \"$3\" (\"$5\")\"}'", { encoding: 'utf-8' });
            diskInfo = dfOutput.trim();
        } catch (e) { diskInfo = 'Error leyendo disco'; }

        const interfaces = os.networkInterfaces();
        let networkInfo = [];
        for (const [name, nets] of Object.entries(interfaces)) {
            for (const net of nets) {
                if (net.family === 'IPv4' && !net.internal) {
                    networkInfo.push(`${name}: ${net.address}`);
                }
            }
        }

        return `
📊 **Estado del Hardware (Tiempo Real)**
- **Uptime**: ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m
- **CPU**: ${cpuModel} (${cpuCores} núcleos)
- **Carga**: ${loadAvg}
- **RAM**: ${usedMem} GB / ${totalMem} GB (${memPercentage}%)
- **Disco**: ${diskInfo}
- **Red**: ${networkInfo.join(', ')}
        `.trim();
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

module.exports = { obtenerSaludServidor };

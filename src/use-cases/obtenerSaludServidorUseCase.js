const os = require('os');
const { execSync } = require('child_process');

/**
 * Recopila y formatea la información de hardware del servidor.
 * @returns {string} Reporte del sistema
 */
function obtenerSaludServidor() {
    try {
        // 1. Memoria RAM
        const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(2);
        const freeMem = (os.freemem() / (1024 ** 3)).toFixed(2);
        const usedMem = (totalMem - freeMem).toFixed(2);
        const memPercentage = ((usedMem / totalMem) * 100).toFixed(1);

        // 2. CPU
        const cpus = os.cpus();
        const cpuModel = cpus[0].model;
        const cpuCores = cpus.length;
        const loadAvg = os.loadavg().map(load => load.toFixed(2)).join(', ');

        // 3. Uptime
        const uptimeSeconds = os.uptime();
        const uptimeDays = Math.floor(uptimeSeconds / (3600 * 24));
        const uptimeHours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
        const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

        // 4. Disco (Raíz en Ubuntu)
        let diskInfo = 'No disponible';
        try {
            const dfOutput = execSync("df -h / | awk 'NR==2 {print \"Total: \"$2\", Usado: \"$3\" (\"$5\")\"}'", { encoding: 'utf-8' });
            diskInfo = dfOutput.trim();
        } catch (e) {
            diskInfo = 'Error leyendo disco';
        }

        // 5. Red (Tailscale y Local)
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
📊 **Reporte de Salud del Servidor Arturo (Ubuntu)**
- **OS**: ${os.type()} ${os.release()} (${os.arch()})
- **Uptime**: ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m

🧠 **CPU**:
- **Modelo**: ${cpuModel}
- **Núcleos**: ${cpuCores}
- **Carga (1m, 5m, 15m)**: ${loadAvg}

💾 **Memoria RAM**:
- **Uso**: ${usedMem} GB / ${totalMem} GB (${memPercentage}%)
- **Libre**: ${freeMem} GB

💽 **Almacenamiento (Raíz)**:
- ${diskInfo}

🌐 **Red**:
- ${networkInfo.length > 0 ? networkInfo.join('\n- ') : 'Sin conexión IPV4 pública/Tailscale'}
        `.trim();
    } catch (error) {
        return `Error al obtener información del sistema: ${error.message}`;
    }
}

module.exports = { obtenerSaludServidor };

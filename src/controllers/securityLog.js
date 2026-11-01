/**
 * src/controllers/securityLog.js — Bitácora Centralizada de Telemetría de Seguridad
 * 
 * Permite que aplicaciones satélite (OasisStore, FloresByDolly, bots) reporten
 * eventos de seguridad (bloqueos, escaneos, rate limits) de forma asíncrona.
 * CERO interferencia con el tráfico de clientes en las tiendas web.
 */

const fs = require('fs');
const path = require('path');
const { enviarNotificacionLocal } = require('./notificaciones');
const { VAULT_PATH_BOVEDA } = require('../config/env');

function registrarEventoSeguridad(req, res) {
    try {
        const {
            origen = 'WebSatélite',
            evento = 'EventoSeguridad',
            ip = req.ip || 'desconocida',
            detalles = '',
            nivel = 'info' // 'info', 'warning', 'alerta'
        } = req.body || {};

        const timestamp = new Date().toISOString();
        const emoji = nivel === 'alerta' ? '🚨' : (nivel === 'warning' ? '⚠️' : 'ℹ️');
        const logLine = `[${timestamp}] ${emoji} [${origen}] ${ip} → ${evento}: ${detalles}\n`;

        // 1. Anexar a /app/seguridad.log
        const logPath = path.join(__dirname, '../../seguridad.log');
        fs.appendFile(logPath, logLine, 'utf8', (err) => {
            if (err) console.error('[SECURITY_LOG] Error escribiendo en seguridad.log:', err.message);
        });

        // 2. Si el nivel es alerta, disparar notificación push inmediata al móvil
        if (nivel === 'alerta' && enviarNotificacionLocal) {
            enviarNotificacionLocal({
                titulo: `🛡️ Alerta Seguridad: ${origen}`,
                mensaje: `${evento} desde IP ${ip}. ${detalles}`.substring(0, 200),
                tipo: 'alerta'
            });
        }

        // 3. Registrar en la Bóveda de Obsidian si está montada
        try {
            let boveda = VAULT_PATH_BOVEDA || process.env.VAULT_PATH_BOVEDA || '/home/ronald/ARTURO/Cerebro/Boveda';
            if (!fs.existsSync(boveda) && fs.existsSync('Z:\\Cerebro\\Boveda')) {
                boveda = 'Z:\\Cerebro\\Boveda';
            }
            if (fs.existsSync(boveda)) {
                const segFolder = path.join(boveda, 'Seguridad');
                if (!fs.existsSync(segFolder)) {
                    fs.mkdirSync(segFolder, { recursive: true });
                }
                const bitacoraPath = path.join(segFolder, 'Bitacora-Web.md');
                const markdownEntry = `- **${timestamp}** | \`${origen}\` | \`${ip}\` | **${evento}**: ${detalles}\n`;
                fs.appendFileSync(bitacoraPath, markdownEntry, 'utf8');
            }
        } catch (vaultErr) {
            // Falla silenciosa si la bóveda no está lista; nunca romper la respuesta
            console.warn('[SECURITY_LOG] Bóveda no accesible para bitácora:', vaultErr.message);
        }

        console.log(`[SECURITY_LOG] ${emoji} Evento registrado desde ${origen} (${ip})`);
        return res.status(201).json({ ok: true, registrado: true, timestamp });
    } catch (err) {
        console.error('[SECURITY_LOG] Error general procesando evento:', err.message);
        return res.status(500).json({ error: 'Error procesando evento de seguridad' });
    }
}

module.exports = { registrarEventoSeguridad };

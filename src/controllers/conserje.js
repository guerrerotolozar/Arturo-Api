/**
 * src/controllers/conserje.js — Controlador Thin (Solo HTTP y Candado)
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH } = require('../config/env');
const { procesarInboxCompleto } = require('../use-cases/organizarInboxUseCase');

// Candado global para evitar colapsar la CPU
let procesandoInbox = false;

async function limpiarInbox(req, res) {
    // 1. Validar Candado
    if (procesandoInbox) {
        return res.status(429).json({ 
            mensaje: "Arturo ya está procesando el Inbox. Por favor, espere a que termine." 
        });
    }

    const inboxPath = path.join(VAULT_PATH, 'Inbox');
    
    // 2. Validar Estado del Sistema de Archivos
    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: 'El Inbox está vacío o no existe.' });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: 'No hay notas pendientes en el Inbox.' });
    }

    // 3. El Notario Responde de Inmediato (HTTP 202)
    res.status(202).json({
        mensaje: `¡Orden recibida! Arturo procesará ${archivos.length} notas en segundo plano.`,
        archivos_pendientes: archivos,
        advertencia: "Como se usa CPU, esto tomará unos minutos. Revisa tu Obsidian más tarde."
    });

    // 4. Cerramos el candado y ejecutamos en background
    procesandoInbox = true;

    (async () => {
        try {
            console.log(`\n[ORGANIZADOR V6 - SOLID] Iniciando procesamiento en SEGUNDO PLANO...`);
            
            // DELEGAMOS TODA LA MAGIA AL CASO DE USO
            const resultados = await procesarInboxCompleto(inboxPath);

            console.log(`\n==================================================`);
            console.log(`[✅ ÉXITO] ¡Inbox limpiado! Procesados ${resultados.length} archivos.`);
            console.log(`==================================================\n`);

        } catch (err) {
            console.error(`\n[ORGANIZADOR ERROR SEGUNDO PLANO] Fallo fatal: ${err.message}`);
        } finally {
            // Siempre abrimos el candado al final
            procesandoInbox = false;
        }
    })();
}

module.exports = limpiarInbox;
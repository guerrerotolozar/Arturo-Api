const { llamarOllama } = require('../adapters/ollamaAdapter');
const { OLLAMA_MODEL } = require('../config/env');
const { enviarNotificacionLocal } = require('../controllers/notificaciones');
const { exec } = require('child_process');

async function procesarActualizacionBarata(paquetesCrudos) {
    const prompt = `El servidor actualizó exitosamente los siguientes paquetes en segundo plano: ${paquetesCrudos}. 
    Escribe un mensaje breve (máximo 2 líneas) diciendo qué cosas interesantes se actualizaron y que el servidor sigue online sin necesidad de reiniciar. Responde de manera directa, sin saludos ni comillas.`;
    
    try {
        const mensajeIA = await llamarOllama(prompt, OLLAMA_MODEL);
        enviarNotificacionLocal({
            titulo: '✅ Actualización Silenciosa',
            mensaje: mensajeIA,
            tipo: 'sistema'
        });
    } catch (error) {
        console.error("[SysAdmin] Error procesando barata:", error);
    }
}

async function alertarActualizacionPesada(paquetesCrudos) {
    const prompt = `Vienen actualizaciones críticas para el servidor: ${paquetesCrudos}. 
    Redacta un mensaje breve (máximo 2 líneas) advirtiéndome qué cosas pesadas vienen (ej. Kernel, sistema base). Termina preguntando si instalas la actualización AHORA o EN LA NOCHE. Responde directamente.`;
    
    try {
        const mensajeIA = await llamarOllama(prompt, OLLAMA_MODEL);
        enviarNotificacionLocal({
            titulo: '⚠️ Reinicio Requerido',
            mensaje: mensajeIA,
            tipo: 'sysadmin_prompt' // Esto le dirá a ArturoApp que renderice los botones
        });
    } catch (error) {
        console.error("[SysAdmin] Error procesando pesada:", error);
    }
}

async function alertarFalloNvidia(driver) {
    enviarNotificacionLocal({
        titulo: '🚨 Pánico de NVIDIA Resuelto',
        mensaje: `El driver NVIDIA falló inesperadamente. Arturo-SysAdmin ya ejecutó el protocolo de purga e instaló automáticamente ${driver}. Reiniciando sistema...`,
        tipo: 'sistema'
    });
}

function ejecutarComando(accion) {
    const fs = require('fs');
    const path = require('path');
    const flagPath = path.join(__dirname, '../../scripts/actualizar.flag');

    if (accion === 'ahora') {
        enviarNotificacionLocal({
            titulo: 'Actualizando',
            mensaje: 'Comenzando actualización crítica. El servidor host se reiniciará en breve.',
            tipo: 'sistema'
        });
        // Crear bandera para que el Host la detecte y ejecute la actualización
        fs.writeFileSync(flagPath, 'ahora');
    } else if (accion === 'noche') {
        enviarNotificacionLocal({
            titulo: 'Programado',
            mensaje: 'Entendido. Actualización programada para las 03:00 AM en el host.',
            tipo: 'sistema'
        });
        fs.writeFileSync(flagPath, 'noche');
    }
}

module.exports = { procesarActualizacionBarata, alertarActualizacionPesada, alertarFalloNvidia, ejecutarComando };

const { execSync } = require('child_process');

/**
 * Reinicia el servidor con validación de seguridad.
 * @param {boolean} confirmacion - Bandera de modo seguro
 * @returns {string} Resultado de la ejecución o mensaje de validación
 */
function reiniciarServidor(confirmacion) {
    if (confirmacion !== true) {
        return `🛑 [MODO SEGURO] Por favor, pide confirmación al usuario antes de reiniciar el servidor. Si confirma, pasa confirmacion: true.`;
    }
    try {
        execSync('sudo reboot');
        return 'Reiniciando el servidor...';
    } catch (e) {
        return `❌ Error al intentar reiniciar: ${e.message}`;
    }
}

module.exports = { reiniciarServidor };

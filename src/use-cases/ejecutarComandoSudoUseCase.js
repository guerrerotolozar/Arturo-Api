const { execSync } = require('child_process');

/**
 * Ejecuta comandos sudo en la torre con validación de seguridad.
 * @param {string} comando - El comando a ejecutar
 * @param {boolean} confirmacion - Bandera de modo seguro
 * @returns {string} Resultado de la ejecución o mensaje de validación
 */
function ejecutarComandoSudo(comando, confirmacion) {
    if (!comando) return 'Error: Debes proporcionar un "comando" para ejecutar con sudo.';
    
    // MODO SEGURO: Validación estricta
    if (confirmacion !== true) {
        return `🛑 [MODO SEGURO ACTIVO] Ejecución bloqueada. El comando es potencialmente peligroso: "sudo ${comando}". \nPor favor, respóndele al usuario explicándole qué hace el comando y pídele que CONFIRME explícitamente si desea ejecutarlo. \nSolo cuando te diga que sí, vuelve a usar esta herramienta con "confirmacion": true.`;
    }

    // Ejecución Real si hay confirmación
    try {
        const sudoOutput = execSync(`sudo ${comando}`, { encoding: 'utf-8' });
        return `✅ Comando ejecutado con éxito:\n${sudoOutput}`;
    } catch (e) {
        return `❌ Error al ejecutar sudo:\n${e.message}\n(Asegúrate de que el usuario esté en /etc/sudoers con NOPASSWD para este comando)`;
    }
}

module.exports = { ejecutarComandoSudo };

const { ejecutarComandoSudo } = require('../use-cases/ejecutarComandoSudoUseCase');
const { reiniciarServidor } = require('../use-cases/reiniciarServidorUseCase');
const { obtenerEstadoPm2 } = require('../use-cases/obtenerEstadoPm2UseCase');

module.exports = {
  nombre: 'systemActionTool',
  descripcion: 'Ejecuta comandos root en el servidor físico. Parámetros esperados: {"action": "sudo" | "reboot" | "modo_juegos" | "pm2_status", "comando": string (solo si action es sudo), "confirmacion": boolean}. REGLA CRÍTICA: Para "sudo" o "reboot", si el usuario no te ha dado su aprobación directa y explícita en este turno, envía "confirmacion": false para activar el Modo Seguro.',
  ejecutar: async (params) => {
    // Garantizar que params sea un objeto
    const parametros = typeof params === 'string' ? { action: params } : (params || {});
    const { action, comando, confirmacion } = parametros;
    let resultado = '';

    try {
      switch (action) {
        case 'sudo':
          resultado = ejecutarComandoSudo(comando, confirmacion);
          break;
        case 'reboot':
          resultado = reiniciarServidor(confirmacion);
          break;
        case 'modo_juegos':
          // Placeholder para la configuración futura
          resultado = '🎮 ¡Modo Juegos activado virtualmente! Preparando recursos para Moonlight / Sunshine (En espera de la instalación de la GPU RTX 5060ti).';
          break;
        case 'pm2_status':
          resultado = obtenerEstadoPm2();
          break;
        default:
          resultado = `Acción no reconocida: ${action}. Acciones permitidas: sudo, reboot, modo_juegos, pm2_status.`;
      }
    } catch (error) {
      resultado = `Error en el tool: ${error.message}`;
    }

    return {
      resumen: `Resultado del comando de sistema`,
      datos: { resultado }
    };
  }
};

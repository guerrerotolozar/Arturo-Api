const { obtenerSaludServidor } = require('../use-cases/obtenerSaludServidorUseCase');

module.exports = {
  nombre: 'systemInfoTool',
  descripcion: 'Obtiene el estado de salud y especificaciones de hardware del servidor físico donde reside Arturo (Uso de CPU, RAM, Disco, Red y Uptime). Útil cuando el usuario pregunta por el estado de la máquina o de la torre.',
  ejecutar: async () => {
    const reporte = obtenerSaludServidor();
    return {
      resumen: reporte,
      datos: { exito: true }
    };
  }
};

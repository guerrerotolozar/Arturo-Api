const { obtenerSaludServidor } = require('../use-cases/obtenerSaludServidorUseCase');

module.exports = {
  nombre: 'systemInfoTool',
  descripcion: 'Obtiene la FICHA TÉCNICA COMPLETA del servidor físico de Ronald (La Torre): especificaciones de hardware (CPU, RAM, GPU, PSU), consumo eléctrico estimado (TDP, watts, kWh), estado en tiempo real (uso de CPU, RAM, disco, red, uptime). Úsala cuando Ronald pregunte por el servidor, la torre, el hardware, el consumo, los costos de electricidad o el estado de la máquina.',
  ejecutar: async () => {
    const reporte = obtenerSaludServidor();
    return {
      resumen: reporte,
      datos: { exito: true }
    };
  }
};

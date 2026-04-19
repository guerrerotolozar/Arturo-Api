const { analizarImagen } = require('../adapters/visionAdapter');

module.exports = {
    nombre:      'vision',
    descripcion: 'Analiza una imagen y extrae texto, datos y contexto visual. Requiere "imagen" (ruta absoluta o base64) y opcionalmente "instruccion" (qué extraer).',
    async ejecutar({ imagen, instruccion }) {
        if (!imagen) throw new Error('visionTool: falta el campo "imagen"');
        const resultado = await analizarImagen(imagen, instruccion);
        return { resumen: resultado.texto, datos: resultado };
    }
};
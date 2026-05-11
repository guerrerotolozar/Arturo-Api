const { crearNota } = require('../use-cases/crearNotaUseCase');

async function crearNotaHandler(req, res) {
    const { titulo, contexto, carpeta = 'Inbox', tipo = 'nota', directo = false } = req.body;
    if (!titulo || !contexto) return res.status(400).json({ error: 'Faltan titulo y contexto.' });
    console.log(`[NOTA] Creando: "${titulo}"`);
    try {
        const r = await crearNota({ titulo, contexto, carpeta, tipo, directo });
        if (!r.creada) return res.status(409).json({ mensaje: `"${titulo}" ya existe.`, ruta: r.ruta });
        res.status(201).json({ mensaje: 'Nota creada.', ruta: r.ruta, contenido_preview: r.contenidoPreview });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
module.exports = crearNotaHandler;
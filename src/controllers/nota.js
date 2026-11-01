const fs = require('fs');
const path = require('path');

async function crearNotaHandler(req, res) {
    const { titulo, contexto, carpeta = 'Inbox' } = req.body;
    if (!titulo || !contexto) return res.status(400).json({ error: 'Faltan titulo y contexto.' });
    console.log(`[NOTA] Agregando a: "${titulo}"`);
    try {
        const boveda = process.env.VAULT_PATH_BOVEDA || '/home/ronald/ARTURO/Cerebro/Boveda';
        const rutaCarpeta = path.join(boveda, carpeta);
        const rutaArchivo = path.join(rutaCarpeta, `${titulo}.md`);
        
        if (!fs.existsSync(rutaCarpeta)) {
            fs.mkdirSync(rutaCarpeta, { recursive: true });
        }
        
        const fecha = new Date().toISOString();
        const contenido = `\n---\nAgregado el: ${fecha}\n\n${contexto}\n`;
        fs.appendFileSync(rutaArchivo, contenido, 'utf8');
        
        res.status(201).json({ mensaje: 'Texto agregado correctamente.', ruta: rutaArchivo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}
module.exports = crearNotaHandler;

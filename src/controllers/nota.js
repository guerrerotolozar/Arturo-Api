const fs = require('fs');
const path = require('path');

async function crearNotaHandler(req, res) {
    const { titulo, contexto, carpeta = 'Inbox' } = req.body;
    if (!titulo || !contexto) return res.status(400).json({ error: 'Faltan titulo y contexto.' });

    // Sanitizar título para evitar secuencias de path traversal en el nombre
    const safeTitulo = titulo.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    if (!safeTitulo) return res.status(400).json({ error: 'Título inválido.' });

    console.log(`[NOTA] Agregando a: "${safeTitulo}"`);
    try {
        const boveda = process.env.VAULT_PATH_BOVEDA || '/home/ronald/ARTURO/Cerebro/Boveda';
        const resolvedBase = path.resolve(boveda);
        const carpetaNormalizada = carpeta === 'OPERACIONES/OasisStore' ? 'OPERACIONES/Proyectos/OasisStore' : carpeta;
        const rutaCarpeta = path.resolve(boveda, carpetaNormalizada);

        // Prevenir Path Traversal: asegurar que rutaCarpeta permanezca estrictamente dentro del Vault
        if (!rutaCarpeta.startsWith(resolvedBase + path.sep) && rutaCarpeta !== resolvedBase) {
            return res.status(400).json({ error: 'Ruta no permitida fuera de la bóveda.' });
        }

        const rutaArchivo = path.join(rutaCarpeta, `${safeTitulo}.md`);
        
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

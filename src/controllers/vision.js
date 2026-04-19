const multer = require('multer');
const sharp = require('sharp');
const { analizarImagen } = require('../adapters/visionAdapter');

// Configuramos multer para interceptar un archivo llamado "imagen" y guardarlo en memoria
const upload = multer({ storage: multer.memoryStorage() }).single('imagen');

const procesarVision = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: 'Error al procesar la subida del archivo', detalle: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'Falta el archivo "imagen"' });
        }

        try {
            // Procesar la imagen con sharp al vuelo desde el buffer
            // Redimensiona a máximo 1024px de ancho (sin agrandar) y fuerza a JPEG con calidad 80
            const bufferOptimizado = await sharp(req.file.buffer)
                .resize({ width: 1024, withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();

            // Convertir a base64
            const base64Str = bufferOptimizado.toString('base64');
            
            // Obtener instrucción opcional del body
            const instruccion = req.body.instruccion || null;

            // Llamar al adaptador pasando el base64 y la instrucción
            const resultado = await analizarImagen(base64Str, instruccion);
            
            // Retornar la respuesta del adaptador
            return res.status(200).json(resultado);
        } catch (error) {
            console.error('[VISION CONTROLLER] Error al procesar la imagen:', error);
            
            // Devolver 503 o 500 según el tipo de error
            const status = (error.message && error.message.includes('503')) ? 503 : 500;
            return res.status(status).json({ 
                error: 'Error interno al procesar la visión', 
                detalle: error.message 
            });
        }
    });
};

module.exports = procesarVision;

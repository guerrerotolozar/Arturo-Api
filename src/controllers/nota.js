/**
 * Controlador de Nota Estructurada — IA crea notas completas en el vault.
 * Ruta: POST /IA/nota
 * Motor: llama3.1 (DEEP) — Genera el contenido Markdown de la nota.
 *
 * Body esperado:
 * {
 *   "titulo":   "Nombre de la nota",          // requerido
 *   "contexto": "Descripción o prompt breve", // requerido — IA expande esto
 *   "carpeta":  "Finanzas",                   // opcional (default: Inbox)
 *   "tipo":     "proyecto"                    // opcional (default: nota)
 * }
 */

const { consultarIAFast } = require('../services/llmService');
const { crearNotaEstructurada } = require('../services/vaultService');
const { obtenerTimestamp, obtenerFechaHoraLocal } = require('../utils/dateUtils');

/**
 * Handler para POST /IA/nota
 */
async function crearNota(req, res) {
    const { titulo, contexto, carpeta = 'Inbox', tipo = 'nota' } = req.body;

    if (!titulo || !contexto) {
        return res.status(400).json({
            error: 'Faltan campos requeridos.',
            requeridos: { titulo: 'string', contexto: 'string' },
            opcionales: { carpeta: 'string (default: Inbox)', tipo: 'string (default: nota)' }
        });
    }

    console.log(`[IA NOTA] Generando nota: "${titulo}" → ${carpeta}/`);

    try {
        // IA genera el cuerpo de la nota basándose en el contexto
        const promptContenido = `Eres IA, el asistente personal de Ronald, un desarrollador Full-Stack colombiano.
Tu tarea es generar el contenido Markdown para una nota de su Segundo Cerebro en Obsidian.

Instrucciones:
- Escribe SOLO el contenido Markdown (sin el título H1, ese ya se agrega automáticamente).
- Usa formato Obsidian: [[Concepto]] para enlazar entidades, metas, proyectos o tecnologías.
- Estructura con secciones H2 (##) cuando tenga sentido.
- Tono técnico, ejecutivo, directo. Sin relleno.
- Máximo 400 palabras.

Título de la nota: "${titulo}"
Tipo: ${tipo}
Carpeta destino: ${carpeta}
Contexto / instrucciones específicas: ${contexto}

Contenido Markdown:`;

        const contenidoGenerado = await consultarIAFast(promptContenido);

        const timestamp = obtenerTimestamp();
        const resultado = crearNotaEstructurada({
            titulo,
            contenido: '\n' + contenidoGenerado,
            carpeta,
            tipo,
            timestamp
        });

        if (!resultado.creada) {
            return res.status(409).json({
                mensaje: `La nota "${titulo}" ya existe en ${carpeta}/. No se sobreescribió.`,
                ruta: resultado.ruta
            });
        }

        res.status(201).json({
            mensaje: `Nota creada correctamente.`,
            ruta: resultado.ruta,
            titulo,
            carpeta,
            tipo,
            timestamp,
            contenido_preview: contenidoGenerado.substring(0, 200) + '...'
        });

        console.log(`[IA NOTA] Nota creada: ${resultado.ruta}`);

    } catch (err) {
        console.error(`[IA NOTA ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al crear la nota.', detalle: err.message });
    }
}

module.exports = crearNota;
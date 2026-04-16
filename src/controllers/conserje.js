/**
 * Controlador del Agente Organizador.
 * Ruta: POST /IA/limpiar-inbox
 * Motor: llama3.1 (DEEP) — Lee notas crudas, las estructura y las mueve a su lugar.
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');
    
    // Validar si el Inbox existe o está vacío
    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: "El Inbox está vacío o no existe." });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: "No hay notas pendientes por limpiar en el Inbox." });
    }

    // Le avisamos a Postman que empezamos el trabajo pesado
    console.log(`\n[ORGANIZADOR] Encontré ${archivos.length} notas en el Inbox. Empezando limpieza profunda...`);
    let procesados = [];

    try {
        for (const archivo of archivos) {
            const rutaVieja = path.join(inboxPath, archivo);
            const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

            console.log(`[ORGANIZADOR] Analizando: ${archivo}`);

            const prompt = `Eres el Agente Organizador del Segundo Cerebro de Ronald.
Tu tarea es leer una nota rápida y cruda del Inbox, darle formato profesional en Markdown, extraer conceptos clave y decidir en qué subcarpeta de la bóveda debería guardarse.
${PERFIL_RONALD}

Nota cruda original:
"""
${contenidoCrudo}
"""

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "titulo_nuevo": "Nombre descriptivo de la nota en PascalCase o Normal",
  "carpeta_destino": "Nombre de la carpeta o subcarpeta (ej. VIDA/MOTO, Finanzas, Profesional)",
  "contenido_md": "El contenido reescrito, bien formateado, usando viñetas si es necesario y usando [[Concepto]] para enlazar entidades clave."
}`;

            // Llamada directa a Ollama forzando el formato JSON
            const response = await fetch(OLLAMA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL_DEEP, // Llama 3.1 piensa mejor la estructura
                    prompt: prompt,
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) throw new Error(`Ollama falló: ${response.status}`);
            
            const data = await response.json();
            const estructura = JSON.parse(data.response);

            // Preparar la mudanza de archivos
            const carpetaDestino = path.join(VAULT_PATH, estructura.carpeta_destino);
            if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });

            const nombreArchivoNuevo = estructura.titulo_nuevo.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_') + '.md';
            const rutaNueva = path.join(carpetaDestino, nombreArchivoNuevo);

            // Re-armar el frontmatter
            const timestamp = obtenerTimestamp();
            const notaFinal = [
                '---',
                `tipo: nota_procesada`,
                `creado: ${timestamp}`,
                `fuente: Agente_Organizador`,
                '---',
                `# ${estructura.titulo_nuevo}`,
                '',
                estructura.contenido_md
            ].join('\n');

            // Guardar en destino y borrar del Inbox
            fs.writeFileSync(rutaNueva, notaFinal);
            fs.unlinkSync(rutaVieja);

            console.log(`[ORGANIZADOR] Mudanza exitosa: Inbox/${archivo} ➔ ${estructura.carpeta_destino}/${nombreArchivoNuevo}`);
            
            procesados.push({
                original: archivo,
                nuevo_titulo: estructura.titulo_nuevo,
                ruta: `${estructura.carpeta_destino}/${nombreArchivoNuevo}`
            });
        }

        res.status(200).json({
            mensaje: "Inbox procesado y estructurado con éxito.",
            notas_procesadas: procesados
        });

    } catch (err) {
        console.error(`[ORGANIZADOR ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al procesar el Inbox.', detalle: err.message });
    }
}

module.exports = limpiarInbox;
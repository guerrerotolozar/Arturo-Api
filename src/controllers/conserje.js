/**
 * Controlador del Agente Organizador (V2 - Actualización Inteligente).
 * Ruta: POST /IA/limpiar-inbox
 * Motor: llama3.1 (DEEP) + RAG Vectorial (nomic-embed-text)
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');
const { buscarContexto } = require('../services/vaultService'); // <-- IMPORTAMOS EL CEREBRO VECTORIAL

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');
    
    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: "El Inbox está vacío o no existe." });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: "No hay notas pendientes por limpiar en el Inbox." });
    }

    console.log(`\n[ORGANIZADOR] Encontré ${archivos.length} notas en el Inbox. Empezando limpieza y fusión profunda...`);
    let procesados = [];

    try {
        for (const archivo of archivos) {
            const rutaVieja = path.join(inboxPath, archivo);
            const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

            console.log(`[ORGANIZADOR] Analizando: ${archivo}`);

            const prompt = `Eres el Agente Organizador del Segundo Cerebro de Ronald.
Tu tarea es leer una nota rápida y cruda del Inbox, darle formato profesional en Markdown, extraer conceptos clave y decidir de qué trata.
${PERFIL_RONALD}

Nota cruda original:
"""
${contenidoCrudo}
"""

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "tema_central": "Nombre descriptivo y corto del tema (ej. Básculas Dibal, Gixxer 250 SF)",
  "carpeta_sugerida": "Nombre de la carpeta o subcarpeta (ej. Profesional/Importaciones, VIDA/MOTO)",
  "contenido_md": "El contenido reescrito, bien formateado, directo al grano."
}`;

            // 1. LLAMA 3.1 ESTRUCTURA LA NOTA
            const response = await fetch(OLLAMA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL_DEEP,
                    prompt: prompt,
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) throw new Error(`Ollama falló: ${response.status}`);
            const data = await response.json();
            const estructura = JSON.parse(data.response);

            // 2. BÚSQUEDA INTELIGENTE (RAG VECTORIAL)
            console.log(`[ORGANIZADOR] Verificando si ya existe conocimiento sobre: "${estructura.tema_central}"...`);
            const similitudes = await buscarContexto(estructura.tema_central, 3);
            
            let anexado = false;
            let rutaDestinoFinal = "";

            // UMBRAL DE SIMILITUD: 0.80 (80% de coincidencia semántica)
            if (similitudes.length > 0 && similitudes[0].score > 0.80) {
                const mejorMatch = similitudes[0];
                
                // Extraer la ruta real del string "NombreNota (ruta/absoluta.md)"
                const rutaMatch = mejorMatch.fuente.match(/\((.*?)\)$/);
                
                if (rutaMatch) {
                    const rutaRelativa = rutaMatch[1];
                    const rutaAbsoluta = path.join(VAULT_PATH, rutaRelativa);

                    console.log(`[ORGANIZADOR] ¡Match semántico encontrado (${Math.round(mejorMatch.score * 100)}%)! FUSIONANDO con: ${rutaRelativa}`);

                    const timestamp = obtenerTimestamp();
                    // Bloque de adición seguro (nunca sobreescribe)
                    const bloqueAnexo = `\n\n---\n### 📌 Actualización: ${timestamp}\n*Procesado desde Inbox*\n\n${estructura.contenido_md}\n`;

                    fs.appendFileSync(rutaAbsoluta, bloqueAnexo);
                    fs.unlinkSync(rutaVieja); // Destruir el borrador del Inbox

                    rutaDestinoFinal = rutaRelativa;
                    anexado = true;
                }
            }

            // 3. SI NO EXISTE, SE CREA DESDE CERO
            if (!anexado) {
                console.log(`[ORGANIZADOR] Tema nuevo. Creando archivo desde cero...`);
                const carpetaDestino = path.join(VAULT_PATH, estructura.carpeta_sugerida);
                if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });

                const nombreArchivoNuevo = estructura.tema_central.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_') + '.md';
                const rutaNueva = path.join(carpetaDestino, nombreArchivoNuevo);

                const timestamp = obtenerTimestamp();
                const notaFinal = [
                    '---',
                    `tipo: nota_procesada`,
                    `creado: ${timestamp}`,
                    `fuente: Agente_Organizador`,
                    '---',
                    `# ${estructura.tema_central}`,
                    '',
                    estructura.contenido_md
                ].join('\n');

                fs.writeFileSync(rutaNueva, notaFinal);
                fs.unlinkSync(rutaVieja);

                rutaDestinoFinal = `${estructura.carpeta_sugerida}/${nombreArchivoNuevo}`;
            }
            
            procesados.push({
                original: archivo,
                tema: estructura.tema_central,
                accion: anexado ? "Fusionado" : "Creado",
                ruta: rutaDestinoFinal
            });
        }

        res.status(200).json({
            mensaje: "Inbox procesado con éxito.",
            notas_procesadas: procesados
        });

    } catch (err) {
        console.error(`[ORGANIZADOR ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al procesar el Inbox.', detalle: err.message });
    }
}

module.exports = limpiarInbox;
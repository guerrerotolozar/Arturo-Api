/**
 * Controlador del Agente Organizador (V4 Definitiva - Erudito).
 * Ruta: POST /IA/limpiar-inbox
 * Motor: llama3.1 (DEEP) + RAG Vectorial + Web Search + Enlazado Sináptico
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');
const { buscarContexto, obtenerCategorias } = require('../services/vaultService');
const { necesitaInternet } = require('../services/llmService');
const { buscarEnWeb } = require('../services/searchService');

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');
    
    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: "El Inbox está vacío o no existe." });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: "No hay notas pendientes por limpiar en el Inbox." });
    }

    console.log(`\n[ORGANIZADOR V4] Despertando al Agente Erudito para procesar ${archivos.length} notas...`);
    let procesados = [];

    // Obtenemos todos los nombres de las notas para forzar los enlaces [[ ]]
    const listaConceptos = obtenerCategorias().join(', ');

    try {
        for (const archivo of archivos) {
            const rutaVieja = path.join(inboxPath, archivo);
            const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

            console.log(`\n--------------------------------------------------`);
            console.log(`[ORGANIZADOR] Analizando borrador: ${archivo}`);

            // 1. INVESTIGACIÓN PROACTIVA (Tavily)
            let datosWeb = "No se requirió búsqueda en internet.";
            const quiereWeb = await necesitaInternet(contenidoCrudo);
            
            if (quiereWeb) {
                console.log(`[ORGANIZADOR] Detecté dudas en la nota. Buscando en internet...`);
                try {
                    const web = await buscarEnWeb(contenidoCrudo);
                    datosWeb = web.answer ? web.answer : web.results.map(r => r.content).join('\n\n');
                    console.log(`[ORGANIZADOR] Datos web obtenidos exitosamente.`);
                } catch (e) {
                    console.warn(`[ORGANIZADOR] Falló la búsqueda web: ${e.message}. Continuando a ciegas.`);
                }
            } else {
                console.log(`[ORGANIZADOR] No necesita internet. Avanzando con conocimiento local.`);
            }

            // 2. RAG INVERTIDO (Memoria Activa)
            console.log(`[ORGANIZADOR] Buscando dónde encaja esto en la Bóveda...`);
            const similitudes = await buscarContexto(contenidoCrudo, 3);
            
            let contextoVault = "No se encontraron notas previas muy relacionadas.";
            if (similitudes.length > 0) {
                contextoVault = similitudes.map(s => {
                    const rutaMatch = s.fuente.match(/\((.*?)\)$/);
                    const rutaRelativa = rutaMatch ? rutaMatch[1] : s.fuente;
                    return `--- RUTA EXISTENTE: ${rutaRelativa} ---\nExtracto: ${s.texto}`;
                }).join('\n\n');
            }

            // 3. LLAMA 3.1 SINTETIZA (Con esteroides)
            console.log(`[ORGANIZADOR] Llama 3.1 redactando respuesta final...`);
            const prompt = `Eres el Agente Organizador del Segundo Cerebro de Ronald.
Tu tarea es leer una nota cruda del Inbox, investigarla con datos de internet si los hay, revisar si pertenece a algún archivo que ya existe en la bóveda, y estructurarla con enlaces internos.
${PERFIL_RONALD}

=== LISTA DE CONCEPTOS EXISTENTES EN LA BÓVEDA (¡MUY IMPORTANTE!) ===
${listaConceptos}
*REGLA DE SINAPSIS:* Si mencionas alguna de estas entidades en tu redacción, OBLIGATORIAMENTE enciérrala en corchetes dobles, ejemplo: [[Gixxer 250 SF]] o [[Básculas Dibal]].

=== DATOS RECIENTES DE INTERNET ===
${datosWeb}
*REGLA DE DATOS:* Si hay datos útiles aquí (precios, compatibilidades), úsalos para enriquecer la nota.

=== CONTEXTO EXISTENTE EN LA BÓVEDA ===
${contextoVault}

=== NOTA CRUDA DEL INBOX ===
"""${contenidoCrudo}"""

=== REGLAS DE DECISIÓN ESTRICTAS ===
1. FUSIÓN: Si el tema encaja claramente en una de las "RUTAS EXISTENTES" del contexto (ej. es sobre la misma moto o el mismo negocio), elige ACCIÓN: "FUSIONAR" y pon esa ruta EXACTA en "ruta_destino".
2. CREACIÓN: Si es un tema nuevo, elige ACCIÓN: "CREAR". Inventa una ruta_destino CORTA (MÁXIMO 2 niveles, ej. "Proyectos/Carniceria"). PROHIBIDO crear rutas largas.
3. FORMATO: Redacta el "contenido_md" de forma técnica y proactiva. Agrega los datos de internet si aplicaba. USA LOS ENLACES [[ ]].

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
  "accion": "FUSIONAR" o "CREAR",
  "ruta_destino": "Ruta del archivo. Obligatorio que termine en .md",
  "tema_central": "Título corto y descriptivo",
  "contenido_md": "El contenido mejorado, con datos web (si hay) y enlaces [[Concepto]]"
}`;

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

            const timestamp = obtenerTimestamp();
            
            if (!estructura.ruta_destino.endsWith('.md')) {
                estructura.ruta_destino += '.md';
            }
            
            const rutaAbsoluta = path.join(VAULT_PATH, estructura.ruta_destino);
            const carpetaDestino = path.dirname(rutaAbsoluta);
            
            if (!fs.existsSync(carpetaDestino)) {
                fs.mkdirSync(carpetaDestino, { recursive: true });
            }

            // 4. EJECUTAR LA MUDANZA
            if (estructura.accion === "FUSIONAR" && fs.existsSync(rutaAbsoluta)) {
                console.log(`[ORGANIZADOR] Éxito: FUSIONANDO con ${estructura.ruta_destino}`);
                const bloqueAnexo = `\n\n---\n### 📌 Actualización: ${timestamp}\n*Procesado desde Inbox*\n\n${estructura.contenido_md}\n`;
                fs.appendFileSync(rutaAbsoluta, bloqueAnexo);
            } else {
                console.log(`[ORGANIZADOR] Éxito: CREANDO nuevo archivo en ${estructura.ruta_destino}`);
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
                fs.writeFileSync(rutaAbsoluta, notaFinal);
            }

            fs.unlinkSync(rutaVieja);
            
            procesados.push({
                original: archivo,
                tema: estructura.tema_central,
                accion: estructura.accion,
                ruta: estructura.ruta_destino
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
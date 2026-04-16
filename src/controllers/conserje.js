/**
 * Controlador del Agente Organizador (V3 - Memoria Activa).
 * Ruta: POST /IA/limpiar-inbox
 * Motor: llama3.1 (DEEP) + RAG Vectorial Previo
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');
const { buscarContexto } = require('../services/vaultService');

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');
    
    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: "El Inbox está vacío o no existe." });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: "No hay notas pendientes por limpiar en el Inbox." });
    }

    console.log(`\n[ORGANIZADOR] Procesando ${archivos.length} notas con Memoria Activa...`);
    let procesados = [];

    try {
        for (const archivo of archivos) {
            const rutaVieja = path.join(inboxPath, archivo);
            const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

            console.log(`[ORGANIZADOR] Analizando borrador: ${archivo}`);

            // 1. RAG PRIMERO: Buscar si hay contexto en la bóveda que se parezca a la nota cruda
            const similitudes = await buscarContexto(contenidoCrudo, 3);
            
            let contextoVault = "No se encontraron notas previas muy relacionadas.";
            if (similitudes.length > 0) {
                // Le pre-digerimos las rutas a Llama para que no invente carpetas
                contextoVault = similitudes.map(s => {
                    const rutaMatch = s.fuente.match(/\((.*?)\)$/);
                    const rutaRelativa = rutaMatch ? rutaMatch[1] : s.fuente;
                    return `--- RUTA EXISTENTE: ${rutaRelativa} ---\nExtracto: ${s.texto}`;
                }).join('\n\n');
            }

            const prompt = `Eres el Agente Organizador del Segundo Cerebro de Ronald.
Tu tarea es leer una nota cruda del Inbox, revisar si pertenece a algún archivo que ya existe en la bóveda, y estructurarla.
${PERFIL_RONALD}

=== CONTEXTO EXISTENTE EN LA BÓVEDA ===
${contextoVault}

=== NOTA CRUDA DEL INBOX ===
"""${contenidoCrudo}"""

=== REGLAS DE DECISIÓN ESTRICTAS ===
1. IDENTIDAD: Si Ronald habla de "la moto que quiero" o "la moto", revisa el contexto para deducir de qué modelo habla y úsalo en tu redacción. Si habla de cables y carnicería, verifica si encaja en los archivos de básculas.
2. FUSIÓN: Si el tema encaja claramente en una de las "RUTAS EXISTENTES" del contexto, elige ACCIÓN: "FUSIONAR" y pon esa ruta EXACTA en "ruta_destino".
3. CREACIÓN: Si es un tema nuevo, elige ACCIÓN: "CREAR". Inventa una ruta_destino CORTA (MÁXIMO 2 niveles de carpetas, ej. "Proyectos/Carniceria"). PROHIBIDO crear rutas largas.
4. FORMATO: Redacta el "contenido_md" de forma profesional, directa y proactiva, usando viñetas.

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
  "accion": "FUSIONAR" o "CREAR",
  "ruta_destino": "Ruta del archivo (existente o nueva). Obligatorio que termine en .md",
  "tema_central": "Título corto y descriptivo",
  "contenido_md": "El contenido mejorado y estructurado"
}`;

            // 2. LLAMA 3.1 DECIDE CON TODO EL CONTEXTO EN LA MESA
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
            
            // Forzar que siempre termine en .md
            if (!estructura.ruta_destino.endsWith('.md')) {
                estructura.ruta_destino += '.md';
            }
            
            const rutaAbsoluta = path.join(VAULT_PATH, estructura.ruta_destino);
            const carpetaDestino = path.dirname(rutaAbsoluta);
            
            // Garantizar que la carpeta exista (por si decide CREAR)
            if (!fs.existsSync(carpetaDestino)) {
                fs.mkdirSync(carpetaDestino, { recursive: true });
            }

            // 3. EJECUTAR LA ACCIÓN (Seguridad primero)
            if (estructura.accion === "FUSIONAR" && fs.existsSync(rutaAbsoluta)) {
                console.log(`[ORGANIZADOR] Decisión Inteligente: FUSIONANDO con ${estructura.ruta_destino}`);
                const bloqueAnexo = `\n\n---\n### 📌 Actualización: ${timestamp}\n*Procesado desde Inbox*\n\n${estructura.contenido_md}\n`;
                fs.appendFileSync(rutaAbsoluta, bloqueAnexo);
            } else {
                console.log(`[ORGANIZADOR] Decisión Inteligente: CREANDO nuevo archivo en ${estructura.ruta_destino}`);
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

            // Destruir el borrador feo
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
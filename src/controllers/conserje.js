/**
 * Controlador del Agente Organizador (V5 — Arquitectura Auditada).
 * Ruta: POST /IA/limpiar-inbox
 * Motor: llama3.1:8b (Deep) + RAG Vectorial + Tavily + verificacion de fusion
 *
 * CAMBIOS vs V4:
 *
 * 1. RUTEO WEB CORREGIDO
 *    Antes: necesitaInternet(contenidoCrudo) → falsos negativos porque la funcion
 *           espera preguntas explicitas, no notas con verbos implicitos.
 *    Ahora: analizarIntenciones(contenidoCrudo) → CoT + Few-Shot dedicado a notas.
 *           Devuelve {necesitaWeb, queryWeb, topicPrincipal}.
 *           Bonus: queryWeb es una query limpia y focalizada para Tavily, no la nota cruda.
 *
 * 2. FALSO POSITIVO RAG CORREGIDO
 *    Antes: buscarContexto() con umbral 0.5 → RS-232 se fusiona con SSH.
 *    Ahora: buscarCandidatosFusion() con umbral 0.78 → solo candidatos con alta certeza.
 *           + verificarFusion() → segunda pasada con modelo fast para confirmar identidad
 *           tematica antes de ejecutar la fusion.
 *
 * 3. ALUCINACION DE JERGA CORREGIDA
 *    Antes: el prompt no instruia sobre preservacion de texto original.
 *    Ahora: seccion PRESERVACION en el prompt con few-shot especifico:
 *           "200 lucas" → conservar "~200 lucas (~$200.000 COP)", no "$200 COP".
 *           El modelo aprende el patron por analogia, no por lista hardcodeada.
 *
 * 4. TAVILY CON QUERY LIMPIA
 *    Antes: buscarEnWeb(contenidoCrudo) → Tavily recibe hasta 800 chars sin estructura.
 *    Ahora: buscarEnWeb(queryWeb) → query de 5-15 palabras extraida por el LLM.
 */

const fs   = require('fs');
const path = require('path');

const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp }                                          = require('../utils/dateUtils');
const { buscarCandidatosFusion, obtenerCategorias }                 = require('../services/vaultService');
const { analizarIntenciones, verificarFusion }                      = require('../services/llmService');
const { buscarEnWeb }                                               = require('../services/searchService');

// ============================================================
// PROMPT DE SINTESIS — con los 3 fixes de prompt
// ============================================================

/**
 * Construye el prompt del agente organizador.
 * Incluye:
 *   - Chain-of-Thought estructurado (razona antes de decidir)
 *   - Seccion de PRESERVACION con few-shot de jerga colombiana
 *   - Instrucciones de fusion vs creacion con umbral de confianza explicito
 *
 * @param {string} contenidoCrudo
 * @param {string} datosWeb
 * @param {string} contextoVault      - Candidatos de fusion (ya verificados o vacios)
 * @param {string} listaConceptos
 * @param {string} topicPrincipal     - Extraido por analizarIntenciones
 * @returns {string}
 */
function construirPromptConserje(contenidoCrudo, datosWeb, contextoVault, listaConceptos, topicPrincipal) {
    return `Eres el Agente Organizador del Segundo Cerebro de Ronald.
Tu tarea: tomar una nota cruda del Inbox y convertirla en una nota estructurada, decidiendo donde guardarla.
${PERFIL_RONALD}

=== RAZONA ANTES DE DECIDIR (Chain-of-Thought) ===
Antes de generar el JSON, responde estas preguntas internamente:
1. ¿De que trata exactamente esta nota? (topic central: "${topicPrincipal}")
2. ¿Hay un archivo EXISTENTE que habla de exactamente esto? (revisa CONTEXTO VAULT)
3. ¿Hay datos de internet que enriquecen la nota? (revisa DATOS WEB)
4. ¿Cual es la ruta de destino mas corta y logica?

=== PRESERVACION DE TEXTO ORIGINAL (CRITICO) ===
Si el texto original contiene expresiones informales, NO las traduzcas ni normalices.
Conserva el significado con una aclaracion entre parentesis cuando sea ambiguo.

EJEMPLOS DE PRESERVACION CORRECTA:
- "200 lucas" NO es "$200 COP" — es aproximadamente $200.000 COP → escribe "~200 lucas (~$200.000 COP)"
- "un billete" NO es "$1 COP" — es $100.000 COP → escribe "~un billete (~$100.000 COP)"
- "fierro" puede ser dinero o un objeto — conserva la palabra y agrega contexto si es necesario
- "pa ya" significa "para alla/para eso" — parafrasealo sin perder la intencion

=== CONCEPTOS EXISTENTES EN LA BOVEDA ===
${listaConceptos}
REGLA: Cuando menciones cualquier entidad de esta lista, usa [[NombreDeLaEntidad]].

=== DATOS RECIENTES DE INTERNET ===
${datosWeb}
REGLA: Si hay precios, disponibilidades o datos tecnicos aqui, integralos en el contenido_md.

=== CONTEXTO EXISTENTE EN LA BOVEDA (Candidatos para fusion) ===
${contextoVault}
REGLA: Si hay una RUTA EXISTENTE aqui, significa que el RAG la considero suficientemente similar.
Aun asi, SOLO elige FUSIONAR si el tema es el MISMO OBJETO/PROYECTO, no solo el mismo dominio.

=== NOTA CRUDA DEL INBOX ===
"""${contenidoCrudo}"""

=== REGLAS DE DECISION ===
1. FUSIONAR: El tema de la nota es exactamente el mismo que una RUTA EXISTENTE → pon esa ruta EXACTA en ruta_destino.
2. CREAR:    Es un tema nuevo o solo comparte dominio con lo existente → inventa ruta_destino corta (max 2 niveles, ej. "LaboratorioTech/RS232.md").
3. FORMATO:  contenido_md debe ser Markdown limpio con encabezados ## cuando aplique.

Responde UNICAMENTE con JSON valido:
{
  "accion": "FUSIONAR" o "CREAR",
  "ruta_destino": "Ruta/Archivo.md",
  "tema_central": "Titulo corto y descriptivo",
  "contenido_md": "Contenido Markdown mejorado con datos web y enlaces [[Concepto]]",
  "razonamiento": "Una linea explicando por que FUSIONAR o CREAR"
}`;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');

    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: 'El Inbox esta vacio o no existe.' });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));
    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: 'No hay notas pendientes en el Inbox.' });
    }

    console.log(`\n[ORGANIZADOR V5] Iniciando procesamiento de ${archivos.length} nota(s)...`);
    const procesados = [];
    const listaConceptos = obtenerCategorias().join(', ');

    try {
        for (const archivo of archivos) {
            const rutaVieja    = path.join(inboxPath, archivo);
            const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

            console.log(`\n${'─'.repeat(50)}`);
            console.log(`[ORGANIZADOR] Procesando: ${archivo}`);

            // ────────────────────────────────────────
            // PASO 1: ANALIZAR INTENCIONES (FIX 1 + FIX 4)
            // analizarIntenciones() reemplaza necesitaInternet(contenidoCrudo).
            // Detecta intencion implicita en notas Y genera query limpia para Tavily.
            // ────────────────────────────────────────
            console.log(`[ORGANIZADOR] Analizando intenciones con CoT...`);
            const intencion = await analizarIntenciones(contenidoCrudo);
            console.log(`[ORGANIZADOR] Topic: "${intencion.topicPrincipal}" | Web: ${intencion.necesitaWeb}`);

            // ────────────────────────────────────────
            // PASO 2: BUSQUEDA WEB (FIX 4 — query limpia)
            // Usa intencion.queryWeb (5-15 palabras focalizadas) en vez de nota cruda.
            // ────────────────────────────────────────
            let datosWeb = 'No se requirio busqueda en internet para esta nota.';

            if (intencion.necesitaWeb && intencion.queryWeb) {
                console.log(`[ORGANIZADOR] Buscando en internet: "${intencion.queryWeb}"`);
                try {
                    const web = await buscarEnWeb(intencion.queryWeb);
                    datosWeb = web.answer
                        ? web.answer
                        : web.results.slice(0, 3).map(r => `[${r.title}] ${r.content}`).join('\n\n');
                    console.log(`[ORGANIZADOR] Datos web obtenidos.`);
                } catch (e) {
                    console.warn(`[ORGANIZADOR] Fallo busqueda web: ${e.message}. Continuando sin web.`);
                }
            } else if (intencion.necesitaWeb && !intencion.queryWeb) {
                console.warn(`[ORGANIZADOR] necesitaWeb=true pero queryWeb vacia. Saltando busqueda.`);
            }

            // ────────────────────────────────────────
            // PASO 3: RAG DE FUSION (FIX 3 — umbral alto)
            // buscarCandidatosFusion() usa umbral 0.78 (vs 0.5 del RAG informativo).
            // Solo devuelve candidatos con alta certeza semantica.
            // ────────────────────────────────────────
            console.log(`[ORGANIZADOR] Buscando candidatos de fusion (umbral alto)...`);
            const candidatosRaw = await buscarCandidatosFusion(contenidoCrudo, 3);

            // ────────────────────────────────────────
            // PASO 4: VERIFICACION DE FUSION (FIX 3 — segunda pasada)
            // Para cada candidato, verifica identidad tematica con modelo fast.
            // RS-232 vs SSH → rechazo. Quickshifter vs Gixxer → aprobado.
            // ────────────────────────────────────────
            const candidatosVerificados = [];

            for (const candidato of candidatosRaw) {
                const aprobado = await verificarFusion(
                    contenidoCrudo,
                    candidato.notaCompleta,
                    candidato.nombre
                );
                if (aprobado) candidatosVerificados.push(candidato);
            }

            let contextoVault = 'No se encontraron notas existentes suficientemente similares. Crear archivo nuevo.';
            if (candidatosVerificados.length > 0) {
                contextoVault = candidatosVerificados.map(c =>
                    `--- RUTA EXISTENTE: ${c.ruta} (similitud: ${c.score.toFixed(2)}) ---\nExtracto: ${c.fragmento}`
                ).join('\n\n');
            }

            // ────────────────────────────────────────
            // PASO 5: SINTESIS FINAL (FIX 2 — preservacion de jerga)
            // El prompt incluye seccion PRESERVACION con few-shot de jerga colombiana.
            // ────────────────────────────────────────
            console.log(`[ORGANIZADOR] Sintetizando nota final con llama3.1...`);

            const prompt = construirPromptConserje(
                contenidoCrudo,
                datosWeb,
                contextoVault,
                listaConceptos,
                intencion.topicPrincipal
            );

            const response = await fetch(OLLAMA_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    model:  OLLAMA_MODEL_DEEP,
                    prompt: prompt,
                    stream: false,
                    format: 'json'
                })
            });

            if (!response.ok) throw new Error(`Ollama fallo: ${response.status}`);
            const data = await response.json();

            let estructura;
            try {
                estructura = JSON.parse(data.response);
            } catch (parseErr) {
                // Fallback: extraer JSON si el modelo metio texto antes
                const match = data.response.match(/\{[\s\S]*\}/);
                if (match) {
                    estructura = JSON.parse(match[0]);
                } else {
                    throw new Error(`No se pudo parsear JSON del modelo: ${data.response.substring(0, 200)}`);
                }
            }

            // ────────────────────────────────────────
            // PASO 6: VALIDACION Y EJECUCION
            // ────────────────────────────────────────
            if (!estructura.ruta_destino.endsWith('.md')) {
                estructura.ruta_destino += '.md';
            }

            const rutaAbsoluta    = path.join(VAULT_PATH, estructura.ruta_destino);
            const carpetaDestino  = path.dirname(rutaAbsoluta);
            if (!fs.existsSync(carpetaDestino)) {
                fs.mkdirSync(carpetaDestino, { recursive: true });
            }

            const timestamp = obtenerTimestamp();

            if (estructura.accion === 'FUSIONAR' && fs.existsSync(rutaAbsoluta)) {
                console.log(`[ORGANIZADOR] FUSION → ${estructura.ruta_destino}`);
                const razonamiento = estructura.razonamiento ? `\n*Razonamiento: ${estructura.razonamiento}*` : '';
                const bloque = `\n\n---\n### Actualizacion: ${timestamp}\n*Procesado desde Inbox*${razonamiento}\n\n${estructura.contenido_md}\n`;
                fs.appendFileSync(rutaAbsoluta, bloque);
            } else {
                // Si el modelo dijo FUSIONAR pero el archivo no existe, crear igualmente
                if (estructura.accion === 'FUSIONAR') {
                    console.warn(`[ORGANIZADOR] Ruta de fusion no existe. Creando nuevo archivo.`);
                } else {
                    console.log(`[ORGANIZADOR] CREAR → ${estructura.ruta_destino}`);
                }

                const notaFinal = [
                    '---',
                    `tipo: nota_procesada`,
                    `creado: ${timestamp}`,
                    `fuente: Agente_Organizador_V5`,
                    `topic: ${intencion.topicPrincipal}`,
                    '---',
                    `# ${estructura.tema_central}`,
                    '',
                    estructura.contenido_md
                ].join('\n');

                fs.writeFileSync(rutaAbsoluta, notaFinal);
            }

            // Eliminar original del Inbox
            fs.unlinkSync(rutaVieja);
            console.log(`[ORGANIZADOR] Borrador eliminado: ${archivo}`);

            procesados.push({
                original:      archivo,
                tema:          estructura.tema_central,
                accion:        estructura.accion,
                ruta:          estructura.ruta_destino,
                razonamiento:  estructura.razonamiento || '',
                busco_en_web:  intencion.necesitaWeb,
                query_usada:   intencion.queryWeb || null,
                candidatos_rag: candidatosRaw.length,
                candidatos_verificados: candidatosVerificados.length
            });
        }

        res.status(200).json({
            mensaje:         'Inbox procesado con exito.',
            notas_procesadas: procesados
        });

    } catch (err) {
        console.error(`[ORGANIZADOR ERROR] ${err.message}`);
        res.status(500).json({ error: 'Fallo al procesar el Inbox.', detalle: err.message });
    }
}

module.exports = limpiarInbox;
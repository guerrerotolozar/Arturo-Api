/**
 * Controlador del Agente Organizador (V5 — Arquitectura Auditada).
 * Ruta: POST /IA/limpiar-inbox
 * Motor: qwen2.5:14b:8b (Deep) + RAG Vectorial + Tavily + verificacion de fusion
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

const fs = require('fs');
const path = require('path');

const { VAULT_PATH, OLLAMA_URL, OLLAMA_MODEL_DEEP, PERFIL_RONALD } = require('../config/env');
const { obtenerTimestamp } = require('../utils/dateUtils');
const { buscarCandidatosFusion, obtenerCategorias } = require('../services/vaultService');
const { analizarIntenciones, verificarFusion } = require('../services/llmService');
const { buscarEnWeb } = require('../services/searchService');
const { performance } = require('perf_hooks');

// Candado global para evitar colapsar la CPU con dobles peticiones
let procesandoInbox = false;

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
REGLA DE SINAPSIS (¡CRITICO!): Debes integrar organicamente los conceptos de esta lista usando [[Corchetes Dobles]] DENTRO de tu redaccion natural.
NO crees un parrafo al final solo para poner enlaces.
EJEMPLO CORRECTO: "Las basculas [[Dibal]] se instalaran despues de comprar la [[Gixxer 250 SF]]."
EJEMPLO INCORRECTO: "Las basculas se instalaran pronto. [[Dibal]] se refiere a la marca."

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
// HANDLER PRINCIPAL (MODELO NOTARIO - SEGUNDO PLANO)
// ============================================================

async function limpiarInbox(req, res) {
    const inboxPath = path.join(VAULT_PATH, 'Inbox');

    // Si Arturo ya está trabajando, rebota la petición
    if (procesandoInbox) {
        return res.status(429).json({
            mensaje: "Arturo ya está procesando el Inbox. Por favor, espere a que termine."
        });
    }

    if (!fs.existsSync(inboxPath)) {
        return res.status(200).json({ mensaje: 'El Inbox está vacío o no existe.' });
    }

    const archivos = fs.readdirSync(inboxPath).filter(f => f.endsWith('.md'));

    if (archivos.length === 0) {
        return res.status(200).json({ mensaje: 'No hay notas pendientes en el Inbox.' });
    }

    // 1. EL NOTARIO RESPONDE INMEDIATO (Evita el ECONNRESET de Postman)
    res.status(202).json({
        mensaje: `¡Orden recibida! Arturo procesará ${archivos.length} notas en segundo plano.`,
        archivos_pendientes: archivos,
        advertencia: "Como se usa CPU, esto tomará unos minutos. Revisa tu Obsidian más tarde."
    });

    // CERRAMOS EL CANDADO
    procesandoInbox = true;

    console.log(`\n[ORGANIZADOR V5] Iniciando procesamiento en SEGUNDO PLANO de ${archivos.length} nota(s)...`);



    // 2. EL TRABAJO PESADO (Se ejecuta sin bloquear la respuesta HTTP)
    (async () => {
        // ⏱️ MARCA: Inicio de todo el trabajo
        const inicioGlobal = performance.now();
        const procesados = [];
        const listaConceptos = obtenerCategorias().join(', ');

        try {
            for (const archivo of archivos) {
                const rutaVieja = path.join(inboxPath, archivo);
                if (!fs.existsSync(rutaVieja)) continue;

                // ⏱️ MARCA: Inicio de este archivo específico
                const inicioArchivo = performance.now();
                const contenidoCrudo = fs.readFileSync(rutaVieja, 'utf-8');

                console.log(`\n${'─'.repeat(50)}`);
                console.log(`[ORGANIZADOR] Procesando: ${archivo}`);

                // PASO 1: Analizar Intenciones
                console.log(`[ORGANIZADOR] Analizando intenciones con CoT...`);
                let t0 = performance.now();
                const intencion = await analizarIntenciones(contenidoCrudo);
                console.log(`[⏱️ METRICA] CoT completado en: ${((performance.now() - t0) / 1000).toFixed(2)}s`);
                console.log(`[ORGANIZADOR] Topic: "${intencion.topicPrincipal}" | Web: ${intencion.necesitaWeb}`);

                // PASO 2: Búsqueda Web
                let datosWeb = 'No se requirió búsqueda en internet para esta nota.';
                let t1 = performance.now();
                if (intencion.necesitaWeb && intencion.queryWeb) {
                    console.log(`[ORGANIZADOR] Buscando en internet: "${intencion.queryWeb}"`);
                    try {
                        const web = await buscarEnWeb(intencion.queryWeb);
                        datosWeb = web.answer ? web.answer : web.results.slice(0, 3).map(r => `[${r.title}] ${r.content}`).join('\n\n');
                    } catch (e) {
                        console.warn(`[ORGANIZADOR] Falló búsqueda web: ${e.message}.`);
                    }
                }
                console.log(`[⏱️ METRICA] Búsqueda Web completada en: ${((performance.now() - t1) / 1000).toFixed(2)}s`);

                // PASO 3: RAG de Fusión
                console.log(`[ORGANIZADOR] Buscando candidatos de fusión (umbral alto)...`);
                let t2 = performance.now();
                const candidatosRaw = await buscarCandidatosFusion(contenidoCrudo, 3);
                console.log(`[⏱️ METRICA] RAG Vectorial completado en: ${((performance.now() - t2) / 1000).toFixed(2)}s`);

                // PASO 4: Verificación de Fusión
                let t3 = performance.now();
                const candidatosVerificados = [];
                for (const candidato of candidatosRaw) {
                    const aprobado = await verificarFusion(contenidoCrudo, candidato.notaCompleta, candidato.nombre);
                    if (aprobado) candidatosVerificados.push(candidato);
                }
                console.log(`[⏱️ METRICA] Portero Fast completado en: ${((performance.now() - t3) / 1000).toFixed(2)}s`);

                let contextoVault = 'No se encontraron notas existentes suficientemente similares. Crear archivo nuevo.';
                if (candidatosVerificados.length > 0) {
                    contextoVault = candidatosVerificados.map(c =>
                        `--- RUTA EXISTENTE: ${c.ruta} (similitud: ${c.score.toFixed(2)}) ---\nExtracto: ${c.fragmento}`
                    ).join('\n\n');
                }

                // PASO 5: Síntesis Final
                console.log(`[ORGANIZADOR] Sintetizando nota final con el Motor Deep...`);
                let t4 = performance.now();
                const prompt = construirPromptConserje(contenidoCrudo, datosWeb, contextoVault, listaConceptos, intencion.topicPrincipal);

                const response = await fetch(OLLAMA_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: OLLAMA_MODEL_DEEP, prompt: prompt, stream: false, format: 'json' })
                });

                if (!response.ok) throw new Error(`Ollama falló: ${response.status}`);
                const data = await response.json();
                console.log(`[⏱️ METRICA] Síntesis Profunda completada en: ${((performance.now() - t4) / 1000).toFixed(2)}s`);

                let estructura;
                try {
                    estructura = JSON.parse(data.response);
                } catch (parseErr) {
                    const match = data.response.match(/\{[\s\S]*\}/);
                    if (match) estructura = JSON.parse(match[0]);
                    else throw new Error(`No se pudo parsear JSON del modelo.`);
                }

                // PASO 6: Validación y Ejecución Espacial
                if (!estructura.ruta_destino.endsWith('.md')) estructura.ruta_destino += '.md';
                if (estructura.accion === 'CREAR' && !estructura.ruta_destino.startsWith('Boveda/')) {
                    estructura.ruta_destino = path.join('Boveda', estructura.ruta_destino);
                }

                const rutaAbsoluta = path.join(VAULT_PATH, estructura.ruta_destino);
                const carpetaDestino = path.dirname(rutaAbsoluta);
                if (!fs.existsSync(carpetaDestino)) fs.mkdirSync(carpetaDestino, { recursive: true });

                const timestamp = obtenerTimestamp();

                if (estructura.accion === 'FUSIONAR' && fs.existsSync(rutaAbsoluta)) {
                    console.log(`[ORGANIZADOR] FUSIÓN → ${estructura.ruta_destino}`);
                    const razonamiento = estructura.razonamiento ? `\n*Razonamiento: ${estructura.razonamiento}*` : '';
                    const bloque = `\n\n---\n### Actualización: ${timestamp}\n*Procesado desde Inbox*${razonamiento}\n\n${estructura.contenido_md}\n`;
                    fs.appendFileSync(rutaAbsoluta, bloque);
                } else {
                    console.log(`[ORGANIZADOR] CREAR → ${estructura.ruta_destino}`);
                    const notaFinal = [
                        '---', `tipo: nota_procesada`, `creado: ${timestamp}`, `fuente: Agente_Organizador_V5`, `topic: ${intencion.topicPrincipal}`, '---',
                        `# ${estructura.tema_central}`, '', estructura.contenido_md
                    ].join('\n');
                    fs.writeFileSync(rutaAbsoluta, notaFinal);
                }

                fs.unlinkSync(rutaVieja);
                console.log(`[⏱️ METRICA TOTAL] Archivo "${archivo}" procesado en: ${((performance.now() - inicioArchivo) / 1000).toFixed(2)}s`);
            }

            console.log(`\n==================================================`);
            console.log(`[✅ ÉXITO] ¡Inbox limpiado! Tiempo total en background: ${((performance.now() - inicioGlobal) / 1000 / 60).toFixed(2)} minutos`);
            console.log(`==================================================\n`);

        } catch (err) {
            console.error(`\n[ORGANIZADOR ERROR SEGUNDO PLANO] Fallo fatal procesando el Inbox: ${err.message}`);
        } finally {
            procesandoInbox = false;
        }
    })(); // FIN DE LA FUNCIÓN ASÍNCRONA AISLADA
}

module.exports = limpiarInbox;
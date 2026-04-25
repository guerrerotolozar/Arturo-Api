/**
 * src/use-cases/organizarInboxUseCase.js
 *
 * Orquesta el procesamiento de notas del Inbox.
 * No sabe nada de HTTP ni de perf_hooks — eso lo maneja el controlador.
 *
 * ANTES (conserje.js, controlador):
 *   - fs.appendFileSync / writeFileSync / unlinkSync directo en el controlador
 *   - performance.now() mezclado con lógica de negocio
 *   - let procesandoInbox vivía en el controlador
 *   - construirPromptConserje definida en el mismo archivo
 *
 * AHORA:
 *   - El use-case orquesta los 6 pasos, devuelve resultados
 *   - El repositorio maneja el file system
 *   - El controlador maneja el candado, la telemetría y la respuesta HTTP
 */

const path = require('path');
const { VAULT_PATH, PERFIL_RONALD, OLLAMA_URL, OLLAMA_MODEL_DEEP } = require('../config/env');
const { obtenerTimestamp }                = require('../utils/dateUtils');
const { obtenerPrompt }                   = require('../utils/promptManager');
const { buscarCandidatosFusion }          = require('../services/ragService');
const { analizarIntenciones, verificarFusion } = require('../services/llmService');
const { buscarEnWeb }                     = require('../adapters/tavilyAdapter');
const { llamarOllama }                    = require('../adapters/ollamaAdapter');
const { switchTo, liberarVRAM }           = require('../services/vramManagerService');
const {
    leerVaultRecursivo,
    appendArchivo,
    escribirArchivo,
    eliminarArchivo,
    existeArchivo,
    listarArchivosDir,
    asegurarDirectorio
} = require('../repositories/vaultRepository');

// ============================================================
// PROMPT BUILDER — encapsulado en el use-case
// ============================================================

function construirPromptConserje(contenidoCrudo, datosWeb, contextoVault, listaConceptos, topicPrincipal) {
    const promptDefecto = `Eres el Agente Organizador del Segundo Cerebro de Ronald.\nTu tarea: tomar una nota cruda del Inbox y convertirla en una nota estructurada, decidiendo donde guardarla.\n${PERFIL_RONALD}\n\n=== RAZONA ANTES DE DECIDIR (Chain-of-Thought) ===\n1. ¿De que trata exactamente esta nota? (topic central: "{topicPrincipal}")\n2. ¿Hay un archivo EXISTENTE que habla de exactamente esto? (revisa CONTEXTO VAULT)\n3. ¿Hay datos de internet que enriquecen la nota? (revisa DATOS WEB)\n4. ¿Cual es la ruta de destino mas corta y logica?\n\n=== PRESERVACION DE TEXTO ORIGINAL (CRITICO) ===\nSi el texto contiene expresiones informales, NO las traduzcas. Conserva con aclaracion si es ambiguo.\nEJEMPLOS: "200 lucas" → "~200 lucas (~$200.000 COP)" | "un billete" → "~$100.000 COP"\n\n=== REGLAS DE DECISION ===\n1. FUSIONAR: tema exactamente igual a una RUTA EXISTENTE → pon esa ruta EXACTA en ruta_destino.\n2. CREAR: tema nuevo o solo mismo dominio → ruta corta max 2 niveles (ej: "LaboratorioTech/RS232.md").\n3. FORMATO: contenido_md en Markdown limpio con ## cuando aplique.\n\nResponde UNICAMENTE con JSON valido:\n{\n  "accion": "FUSIONAR" o "CREAR",\n  "ruta_destino": "Ruta/Archivo.md",\n  "tema_central": "Titulo corto",\n  "contenido_md": "Contenido Markdown con [[enlaces]] y datos web si aplica",\n  "razonamiento": "Una linea: por que FUSIONAR o CREAR"\n}`;
    const promptBase = obtenerPrompt('organizador_inbox.md', promptDefecto);
    
    return `${promptBase.replace('{topicPrincipal}', topicPrincipal)}

=== CONCEPTOS EXISTENTES EN LA BOVEDA ===
${listaConceptos}
REGLA: Usa [[NombreConcepto]] de forma organica dentro de la redaccion. No al final.

=== DATOS RECIENTES DE INTERNET ===
${datosWeb}

=== CONTEXTO EXISTENTE EN LA BOVEDA (Candidatos para fusion) ===
${contextoVault}
REGLA: Solo fusiona si el tema es el MISMO OBJETO/PROYECTO, no solo el mismo dominio.

=== NOTA CRUDA DEL INBOX ===
"""${contenidoCrudo}"""`;
}

// ============================================================
// PROCESAMIENTO DE UN ARCHIVO
// ============================================================

/**
 * Procesa una sola nota del Inbox: analiza → investiga → RAG → verifica → sintetiza → escribe.
 *
 * @param {string} nombreArchivo   - ej: "MiNota.md"
 * @param {string} inboxPath       - ruta absoluta del Inbox
 * @param {string} listaConceptos  - conceptos actuales del vault para los enlaces
 * @returns {Promise<{original, tema, accion, ruta, razonamiento, buscoWeb, queryUsada, candidatosRag, candidatosVerificados}>}
 */
async function procesarArchivo(nombreArchivo, inboxPath, listaConceptos) {
    const rutaVieja    = path.join(inboxPath, nombreArchivo);
    const contenidoCrudo = require('fs').readFileSync(rutaVieja, 'utf-8');

    console.log(`\n${'─'.repeat(50)}\n[INBOX] Procesando: ${nombreArchivo}`);

    // PASO 1: Analizar intención (CoT Few-Shot dedicado a notas)
    const intencion = await analizarIntenciones(contenidoCrudo);
    console.log(`[INBOX] Topic: "${intencion.topicPrincipal}" | Web: ${intencion.necesitaWeb}`);

    // PASO 2: Búsqueda web con query limpia (no la nota cruda)
    let datosWeb = 'No se requirio busqueda en internet para esta nota.';
    if (intencion.necesitaWeb && intencion.queryWeb) {
        try {
            const web = await buscarEnWeb(intencion.queryWeb);
            datosWeb = web.answer
                ? web.answer
                : web.results.slice(0, 3).map(r => `[${r.title}] ${r.content}`).join('\n\n');
        } catch (e) {
            console.warn(`[INBOX] Fallo busqueda web: ${e.message}`);
        }
    }

    // PASO 3: RAG de fusión (umbral alto)
    const candidatosRaw = await buscarCandidatosFusion(contenidoCrudo, 3);

    // PASO 4: Verificación de fusión (segunda pasada con modelo fast)
    const candidatosVerificados = [];
    for (const c of candidatosRaw) {
        if (await verificarFusion(contenidoCrudo, c.notaCompleta, c.nombre)) {
            candidatosVerificados.push(c);
        }
    }

    const contextoVault = candidatosVerificados.length > 0
        ? candidatosVerificados.map(c => `--- RUTA EXISTENTE: ${c.ruta} (similitud: ${c.score.toFixed(2)}) ---\nExtracto: ${c.fragmento}`).join('\n\n')
        : 'No se encontraron notas existentes suficientemente similares. Crear archivo nuevo.';

    // PASO 5: Síntesis final con Motor Deep
    const prompt = construirPromptConserje(contenidoCrudo, datosWeb, contextoVault, listaConceptos, intencion.topicPrincipal);

    try {
        // VRAM MANAGER: Cargar el modelo profundo para la síntesis
        console.log(`[INBOX VRAM] Cargando modelo profundo para síntesis...`);
        await switchTo(OLLAMA_MODEL_DEEP);

        // Usamos el adapter para beneficiarnos del timeout y manejo de errores centralizado
        const respuestaCruda = await llamarOllama(prompt, OLLAMA_MODEL_DEEP, 'json');

        let estructura;
        try {
            estructura = JSON.parse(respuestaCruda);
        } catch {
            const { extraerJSONValido } = require('../utils/jsonExtractor');
            const jsonLimpio = extraerJSONValido(respuestaCruda);
            if (jsonLimpio) {
                estructura = JSON.parse(jsonLimpio);
            } else {
                console.error(`[INBOX ERROR] Respuesta cruda de Ollama:`, respuestaCruda);
                throw new Error(`No se pudo parsear JSON del modelo`);
            }
        }

        // PASO 6: Escribir en el vault
        const rutaDestino = estructura.ruta_destino || 'Boveda/Inbox/Recuperado.md';
        const accion = estructura.accion || 'CREAR';
        const tema = estructura.tema_central || 'Nota sin clasificar';
        const razonamiento = estructura.razonamiento || '';
        const contenido = estructura.contenido_md || contenidoCrudo;

        let rutaFinal = rutaDestino;
        if (!rutaFinal.endsWith('.md')) rutaFinal += '.md';
        if (accion === 'CREAR' && !rutaFinal.startsWith('Boveda/')) {
            rutaFinal = path.join('Boveda', rutaFinal);
        }

        const rutaAbsoluta = path.join(VAULT_PATH, rutaFinal);
        const timestamp    = obtenerTimestamp();

        if (accion === 'FUSIONAR' && existeArchivo(rutaAbsoluta)) {
            const rzn = razonamiento ? `\n*Razonamiento: ${razonamiento}*` : '';
            appendArchivo(rutaAbsoluta, `\n\n---\n### Actualizacion: ${timestamp}\n*Procesado desde Inbox*${rzn}\n\n${contenido}\n`);
            console.log(`[INBOX] FUSION → ${rutaFinal}`);
        } else {
            const notaFinal = [
                '---', `tipo: nota_procesada`, `creado: ${timestamp}`,
                `fuente: Agente_Organizador_V7`, `topic: ${intencion.topicPrincipal}`, '---',
                `# ${tema}`, '', contenido
            ].join('\n');
            escribirArchivo(rutaAbsoluta, notaFinal);
            console.log(`[INBOX] CREAR → ${rutaFinal}`);
        }

        eliminarArchivo(rutaVieja);

        return {
            original:               nombreArchivo,
            tema:                   tema,
            accion:                 accion,
            ruta:                   rutaFinal,
            razonamiento:           razonamiento,
            buscoWeb:               intencion.necesitaWeb,
            queryUsada:             intencion.queryWeb || null,
            candidatosRag:          candidatosRaw.length,
            candidatosVerificados:  candidatosVerificados.length
        };
    } finally {
        // VRAM MANAGER: Liberar modelo profundo SIEMPRE, incluso si falla
        await liberarVRAM();
    }
}

// ============================================================
// PROCESAMIENTO DEL INBOX COMPLETO
// ============================================================

/**
 * Procesa todas las notas del Inbox de forma secuencial.
 * Devuelve el array de resultados — el controlador decide cómo reportarlos.
 *
 * @param {string} inboxPath - ruta absoluta de la carpeta Inbox
 * @returns {Promise<Array>}
 */
async function procesarInboxCompleto(inboxPath) {
    const archivos     = listarArchivosDir('Inbox');
    const listaConceptos = leerVaultRecursivo().map(n => n.nombre).join(', ');
    const resultados   = [];

    for (const archivo of archivos) {
        // Si ya no existe (procesado en otra iteracion), saltar
        if (!existeArchivo(path.join(inboxPath, archivo))) continue;
        try {
            const resultado = await procesarArchivo(archivo, inboxPath, listaConceptos);
            resultados.push(resultado);
        } catch (err) {
            console.error(`[INBOX] Error procesando "${archivo}": ${err.message}`);
            resultados.push({ original: archivo, error: err.message });
        }
    }

    return resultados;
}

module.exports = { procesarInboxCompleto };
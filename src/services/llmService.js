/**
 * LLMService — Comunicación exclusiva con Ollama.
 * Dual Motor: qwen2.5:1.5b (Fast) + llama3.1:8b (Deep).
 *
 * CHANGELOG v3:
 *   - analizarIntenciones()  NUEVO. CoT + Few-Shot para notas crudas del Inbox.
 *                            Reemplaza llamada directa a necesitaInternet() en el conserje.
 *                            Devuelve {necesitaWeb, queryWeb, topicPrincipal}.
 *   - verificarFusion()      NUEVO. Segunda pasada LLM (fast) para confirmar identidad
 *                            temática antes de fusionar. Elimina falsos positivos del RAG.
 *   - necesitaInternet()     Sin cambios. Solo para consultas directas del usuario.
 */

const {
    OLLAMA_URL,
    OLLAMA_MODEL_FAST,
    OLLAMA_MODEL_DEEP,
    OLLAMA_MODEL_EMBED,
    PERFIL_RONALD
} = require('../config/env');

// ============================================================
// BASE
// ============================================================

async function llamarOllama(prompt, modelo, formato = null) {
    const body = { model: modelo, prompt, stream: false };
    if (formato) body.format = formato;
    const response = await fetch(OLLAMA_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Ollama respondio con status ${response.status}`);
    const data = await response.json();
    return data.response.trim();
}

async function generarEmbedding(texto) {
    const urlEmbed = OLLAMA_URL.replace('/generate', '/embeddings');
    const response = await fetch(urlEmbed, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: OLLAMA_MODEL_EMBED, prompt: texto })
    });
    if (!response.ok) throw new Error(`Fallo al generar embedding: ${response.status}`);
    const data = await response.json();
    return data.embedding;
}

// ============================================================
// NUEVO — analizarIntenciones()
//
// PROBLEMA: necesitaInternet() fue disenada para preguntas explicitas de usuario.
// El conserje le pasaba CONTENIDO CRUDO de notas ("Averiguar lo del quickshifter...").
// Las notas usan verbos de intencion IMPLICITA — "averiguar", "cotizar", "ver si
// importo" — que no disparan ninguna regex. El modelo tampoco detecta la intencion
// porque recibe contexto mezclado sin estructura clara.
//
// SOLUCION: Funcion dedicada para NOTAS, no para preguntas directas.
// Usa Chain-of-Thought con Few-Shot examples que enserian al modelo a razonar
// sobre intencion implicita. Devuelve JSON estructurado con query limpia para Tavily.
//
// POR QUE FEW-SHOT Y NO REGEX:
// El usuario pidio "lo menos hardcodeado posible". Los Few-Shot son ejemplos
// de razonamiento que el modelo generaliza. Si llega una nota con jerga nueva,
// el modelo razona por analogia con los ejemplos — no busca strings fijos.
// ============================================================

/**
 * Analiza una nota cruda del Inbox y extrae su intencion de forma estructurada.
 *
 * @param {string} textoNota - Contenido crudo de la nota
 * @returns {Promise<{necesitaWeb: boolean, queryWeb: string, topicPrincipal: string}>}
 */
async function analizarIntenciones(textoNota) {
    const prompt = `Eres un analista de notas personales.
Analiza la nota y extrae su intencion estrictamente en formato JSON.

---EJEMPLOS---
NOTA: "Instalar quickshifter en la Gixxer 250 SF. Averiguar si conviene importarlo desde AliExpress o comprarlo en Bogota. Ver precios."
RESULTADO: {"razonamiento": "La nota dice 'averiguar' y 'ver precios', requiere datos externos.", "necesitaWeb": true, "queryWeb": "quickshifter Suzuki Gixxer 250 precio Colombia", "topicPrincipal": "quickshifter Gixxer 250 SF"}

NOTA: "Recordar activar el cron de backup del vault a las 3AM."
RESULTADO: {"razonamiento": "Tarea tecnica interna del servidor, no investiga nada.", "necesitaWeb": false, "queryWeb": "", "topicPrincipal": "backup vault cron Linux"}

NOTA: "Bascula Dibal Serie 500 para la carniceria. Cuanto cuesta el arancel en Colombia?"
RESULTADO: {"razonamiento": "Pregunta por el costo del arancel, dato externo cambiante.", "necesitaWeb": true, "queryWeb": "importacion bascula electronica arancel Colombia", "topicPrincipal": "importacion Básculas Dibal Colombia"}

NOTA: "Conexion por cable RS-232 entre el POS y la impresora. Revisar urgente si soporta o si toca digital manual."
RESULTADO: {"razonamiento": "Requiere revisar especificaciones tecnicas (si soporta o no un protocolo) de un equipo externo.", "necesitaWeb": true, "queryWeb": "báscula Dibal software inventario soporte RS-232", "topicPrincipal": "Soporte RS-232 Básculas Dibal"}
---FIN EJEMPLOS---

Ahora analiza esta nota. Responde UNICAMENTE con un JSON valido siguiendo el esquema de los ejemplos.
NOTA: "${textoNota.replace(/"/g, "'").substring(0, 600)}"`;

    try {
        const respuestaRaw = await llamarOllama(prompt, OLLAMA_MODEL_DEEP, 'json');
        const jsonMatch = respuestaRaw.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) throw new Error('No se encontro JSON en la respuesta');
        const resultado = JSON.parse(jsonMatch[0]);
        return {
            necesitaWeb:    Boolean(resultado.necesitaWeb),
            queryWeb:       (resultado.queryWeb || '').trim(),
            topicPrincipal: (resultado.topicPrincipal || 'tema sin clasificar').trim()
        };
    } catch (err) {
        console.warn(`[INTENT NOTA] Error: ${err.message}. Asumiendo sin web.`);
        return { necesitaWeb: false, queryWeb: '', topicPrincipal: 'sin clasificar' };
    }
}

// ============================================================
// NUEVO — verificarFusion()
//
// PROBLEMA: El RAG con umbral 0.5 devuelve "SSH" como candidato para una nota
// sobre "RS-232" porque ambos hablan de conexiones/cables/protocolos. La similitud
// coseno mide cercania semantica del DOMINIO, no identidad de TEMA ESPECIFICO.
//
// SOLUCION: Segunda pasada rapida con modelo FAST. Pregunta binaria directa:
// estos dos textos, son sobre el MISMO tema o solo el mismo dominio?
// Si dice NO -> el conserje descarta la fusion y crea archivo nuevo.
//
// POR QUE MODELO FAST: Es clasificacion binaria simple. El modelo deep seria
// matar moscas a canonazos. Fast es suficiente y 3-5x mas rapido.
// ============================================================

/**
 * Verifica si una nota del Inbox y un candidato del vault son el MISMO tema.
 * Ultima linea de defensa contra falsos positivos del RAG.
 *
 * @param {string} textoInbox      - Contenido de la nota cruda
 * @param {string} textoCandidato  - Fragmento de la nota candidata
 * @param {string} nombreCandidato - Nombre del archivo candidato
 * @returns {Promise<boolean>}
 */
async function verificarFusion(textoInbox, textoCandidato, nombreCandidato) {
    const prompt = `Decide si estos dos textos hablan del MISMO TEMA ESPECIFICO y deben fusionarse.

REGLA: "mismo dominio" NO es suficiente para fusionar. Deben ser el mismo objeto, proyecto o entidad concreta.

EJEMPLOS RAPIDOS:
- "RS-232 entre POS e impresora" + "protocolo SSH para acceso remoto" → mismo dominio (comunicacion), diferente tema → NO
- "quickshifter para Gixxer" + "mantenimiento Gixxer 250 SF" → misma entidad (la moto) → SI
- "importar basculas Dibal" + "notas de la carniceria" → misma entidad (carniceria) → SI
- "webhook bancolombia" + "configuracion SSH Torre" → diferente tema → NO

TEXTO NUEVO:
"""${textoInbox.substring(0, 350)}"""

TEXTO EXISTENTE (${nombreCandidato}):
"""${textoCandidato.substring(0, 350)}"""

Responde UNICAMENTE "SI" o "NO".`;

    try {
        const respuesta = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
        const confirmado = respuesta.trim().toUpperCase().startsWith('SI');
        console.log(`[FUSION CHECK] "${nombreCandidato}": ${confirmado ? 'CONFIRMAR fusion' : 'RECHAZAR fusion'}`);
        return confirmado;
    } catch (err) {
        console.warn(`[FUSION CHECK] Error: ${err.message}. Asumiendo NO (seguro).`);
        return false;
    }
}

// ============================================================
// necesitaInternet — consultas directas de usuario (sin cambios)
// ============================================================

const SENALES_WEB_EXPLICITAS = [
    /busca en internet/i, /busca en la web/i, /busca en google/i,
    /busca online/i, /buscalo en internet/i, /googlea/i,
    /hoy en dia/i, /precio[s]? actual[es]?/i, /precio[s]? de hoy/i,
    /precio[s]? hoy/i, /cuanto vale[n]? hoy/i, /cuanto cuesta[n]? hoy/i,
    /marcas actuales/i, /disponible[s]? hoy/i, /en este momento/i,
    /ahora mismo/i, /noticias de hoy/i, /ultima[s]? noticia[s]?/i,
    /cotizacion actual/i, /tasa de cambio/i, /clima hoy/i,
];

async function necesitaInternet(pregunta) {
    const senal = SENALES_WEB_EXPLICITAS.find(regex => regex.test(pregunta));
    if (senal) {
        console.log(`[INTENT] Senal explicita → SI web. Sin LLM.`);
        return true;
    }
    const prompt = `Determina si esta pregunta necesita datos actualizados de internet.
SI: datos en tiempo real, temporalidad reciente, estados actuales de mercados.
NO: conceptos estables, preguntas sobre notas propias, consejos generales.
Pregunta: "${pregunta}"
Responde UNICAMENTE con "SI" o "NO".`;
    try {
        const r = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);
        const necesita = r.trim().toUpperCase().startsWith('SI');
        console.log(`[INTENT] LLM: ${necesita ? 'SI' : 'NO'} (raw: "${r.trim()}")`);
        return necesita;
    } catch (err) {
        console.warn(`[INTENT] Error: ${err.message}. Asumiendo NO.`);
        return false;
    }
}

// ============================================================
// esPreguntaSimple + consultarIAFast
// ============================================================

const PATRONES_PREGUNTA_SIMPLE = [
    /^[\d\s\+\-\*\/\(\)\^%=.,]+\??\s*$/,
    /cuanto es\s+[\d\s\+\-\*\/]+/i,
    /cuanto\s+(son|da|seria)\s+[\d]/i,
    /\d+\s*[\+\-\*\/x\u00f7]\s*\d+/,
    /^(hola|buenas|hey|que hubo|quiubo|ey|hi)[^a-z]*$/i,
    /^(gracias|listo|ok|okay|perfecto|dale)[^a-z]*$/i,
    /^.?(como estas|como vas|que tal)[^a-z]*\??$/i,
];

function esPreguntaSimple(pregunta) {
    const texto = pregunta.trim();
    if (PATRONES_PREGUNTA_SIMPLE.some(p => p.test(texto))) return true;
    const palabras = texto.split(/\s+/).filter(Boolean);
    const triggersProfundos = ['explica','explicame','como funciona','por que','diferencia entre','ventaja','describe','analiza','resume'];
    if (palabras.length <= 7 && !triggersProfundos.some(p => texto.toLowerCase().includes(p))) return true;
    return false;
}

async function consultarIAFast(pregunta) {
    if (esPreguntaSimple(pregunta)) {
        return llamarOllama(`Responde directo y breve, maximo 2 lineas.\nPregunta: ${pregunta}\nRespuesta:`, OLLAMA_MODEL_FAST);
    }
    return llamarOllama(`Eres IA Fast, asistente de Ronald. Tono tecnico con jerga colombiana. Usa [[Concepto]]. Max 3 parrafos.\n\nPregunta: ${pregunta}\n\nRespuesta:`, OLLAMA_MODEL_FAST);
}

// ============================================================
// clasificarIdea
// ============================================================

async function clasificarIdea(idea, categorias) {
    const prompt = categorias.length === 0
        ? `Propone UN nombre de categoria en PascalCase (max 2 palabras, espanol) para esta idea. Solo la palabra.\n\nIdea: "${idea}"`
        : `Elige la categoria mas apropiada o inventa una en PascalCase. Solo la palabra.\n\nIdea: "${idea}"\nCategorias: ${categorias.join(', ')}`;
    try {
        const r = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
        const limpia = r.split('\n')[0]
            .replace(/[^a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1]/g, '')
            .trim();
        if (!limpia) return 'Inbox';
        if (categorias.length > 0) {
            const match = categorias.find(c => c.toLowerCase() === limpia.toLowerCase())
                || categorias.find(c => limpia.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(limpia.toLowerCase()));
            if (match) return match;
        }
        return limpia;
    } catch (err) {
        return 'Inbox';
    }
}

// ============================================================
// consultarIA — RAG + Web
// ============================================================

async function consultarIA(pregunta, fragmentosVault, datosWeb, fechaHora) {
    const bloqueVault = fragmentosVault.length > 0
        ? `\n=== VAULT ===\n${fragmentosVault.map((f,i) => `[${i+1}] ${f.fuente}\n${f.texto}`).join('\n\n')}\n=== FIN VAULT ===`
        : '';
    const bloqueWeb = datosWeb
        ? `\n=== INTERNET ===\n${datosWeb.answer ? `Resumen: ${datosWeb.answer}\n` : ''}${datosWeb.results.map(r => `${r.title}\n${r.content}`).join('\n')}\n=== FIN INTERNET ===`
        : '';
    const prompt = `Eres IA, asistente de Ronald. ${PERFIL_RONALD}\nFecha: ${fechaHora}\n${bloqueWeb}${bloqueVault}\n\nPregunta: ${pregunta}\n\nRespuesta:`;
    return llamarOllama(prompt, OLLAMA_MODEL_DEEP);
}

// ============================================================
// orquestarTareas
// ============================================================

async function orquestarTareas(pregunta) {
    const prompt = `Cerebro logico de Arturo. Decide que herramientas usar. NO respondas la pregunta.

Herramientas: calculadora (formula), tavily_search (query), vault_search (query), respuesta_directa.

Devuelve: {"tareas": [{"herramienta": "nombre", "parametros": {"clave": "valor"}}]}

Peticion: "${pregunta}"`;
    const r = await llamarOllama(prompt, OLLAMA_MODEL_FAST, 'json');
    try { return JSON.parse(r); }
    catch (e) { return { tareas: [] }; }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    llamarOllama,
    generarEmbedding,
    clasificarIdea,
    necesitaInternet,
    analizarIntenciones,
    verificarFusion,
    consultarIA,
    consultarIAFast,
    orquestarTareas,
    _esPreguntaSimple:         esPreguntaSimple,
    _SENALES_WEB_EXPLICITAS:   SENALES_WEB_EXPLICITAS,
    _PATRONES_PREGUNTA_SIMPLE: PATRONES_PREGUNTA_SIMPLE
};
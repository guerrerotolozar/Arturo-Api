/**
 * LLMService — Comunicación exclusiva con Ollama (qwen2.5:1.5B / Llama3.1).
 * Dual Motor: modelo rápido para clasificación, modelo profundo para RAG.
 *
**/

const { OLLAMA_URL, OLLAMA_MODEL_FAST, OLLAMA_MODEL_DEEP, OLLAMA_MODEL_EMBED, PERFIL_RONALD } = require('../config/env');

// ============================================================
// BASE — llamarOllama
// ============================================================

async function llamarOllama(prompt, modelo) {
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelo, prompt, stream: false })
    });

    if (!response.ok) {
        throw new Error(`Ollama respondio con status ${response.status}`);
    }

    const data = await response.json();
    return data.response.trim();
}

// ============================================================
// BASE — generarEmbedding (Traductor Vectorial)
// ============================================================

/**
 * Convierte un texto en un array de números (vector) usando nomic-embed-text.
 */
async function generarEmbedding(prompt) {
    // El endpoint de embeddings es diferente al de generate
    const urlEmbed = OLLAMA_URL.replace('/generate', '/embeddings');
    
    const response = await fetch(urlEmbed, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            model: OLLAMA_MODEL_EMBED, 
            prompt: prompt 
        })
    });

    if (!response.ok) throw new Error(`Fallo al generar embedding: ${response.status}`);
    const data = await response.json();
    return data.embedding;
}

// ============================================================
// FIX 1 — necesitaInternet()
//
// PROBLEMA: El LLM se sesga con frases de contexto local ("mis notas", "mi vault")
// y devuelve NO aunque el usuario pida explicitamente buscar en web.
//
// SOLUCION: Pre-check en JS con senales explicitas ANTES de llamar a Ollama.
// Si hay una senal explicita → true inmediato, sin LLM.
// Si no → el LLM decide sobre preguntas ambiguas (donde si es bueno).
//
// El codigo no alucina. Las regex no tienen sesgo de contexto.
// ============================================================

const SENALES_WEB_EXPLICITAS = [
    // Comandos directos
    /busca en internet/i,
    /busca en la web/i,
    /busca en google/i,
    /busca online/i,
    /buscalo en internet/i,
    /googlea/i,
    // Temporalidad explicita
    /hoy en dia/i,
    /precio[s]? actual[es]?/i,
    /precio[s]? de hoy/i,
    /precio[s]? hoy/i,
    /cuanto vale[n]? hoy/i,
    /cuanto cuesta[n]? hoy/i,
    /marcas actuales/i,
    /disponible[s]? hoy/i,
    /en este momento/i,
    /ahora mismo/i,
    // Datos en tiempo real
    /noticias de hoy/i,
    /ultima[s]? noticia[s]?/i,
    /cotizacion actual/i,
    /tasa de cambio/i,
    /clima hoy/i,
];

/**
 * Determina si la pregunta requiere busqueda en internet.
 *
 * Flujo:
 *   1. Pre-check JS: senales explicitas → true inmediato (sin LLM).
 *   2. Fallback LLM: preguntas ambiguas donde el modelo si aporta valor.
 *
 * @param {string} pregunta
 * @returns {Promise<boolean>}
 */
async function necesitaInternet(pregunta) {
    // — PASO 1: Pre-check de senales explicitas en JS —
    const senal = SENALES_WEB_EXPLICITAS.find(regex => regex.test(pregunta));

    if (senal) {
        console.log(`[INTENT] Senal explicita detectada en JS: "${senal.source}" → SI web. Sin LLM.`);
        return true;
    }

    // — PASO 2: Delegar al LLM solo preguntas ambiguas —
    const prompt = `Analiza la siguiente pregunta y determina si necesita informacion actualizada de internet.

Criterios para necesitar internet:
- Pide datos en tiempo real (precios, clima, noticias, eventos actuales)
- Hace referencia a temporalidad reciente ("hoy", "esta semana", "ultimamente")
- Pregunta sobre estados actuales de mercados, tecnologia, politica
- Requiere datos que cambian frecuentemente

Criterios para NO necesitar internet:
- Pregunta sobre conceptos, definiciones o teoria estable
- Es una pregunta personal o sobre notas propias (sin pedir datos externos)
- Pide consejos generales o planes sin datos en tiempo real

Pregunta: "${pregunta}"

Responde UNICAMENTE con "SI" o "NO". Nada mas.`;

    try {
        const respuesta = await llamarOllama(prompt, OLLAMA_MODEL_DEEP);
        const upper = respuesta.toUpperCase();
        const necesita = upper.includes('SI') || upper.includes('SI');
        console.log(`[INTENT] LLM decidio: ${necesita ? 'SI' : 'NO'} (raw: "${respuesta}")`);
        return necesita;
    } catch (err) {
        console.warn(`[INTENT] Error al clasificar intencion: ${err.message}. Asumiendo NO.`);
        return false;
    }
}

// ============================================================
// FIX 2 — consultarIAFast()
//
// PROBLEMA: Phi-3 fuerza [[Conceptos]] y parrafos largos incluso en preguntas
// triviales ("2+2"), tardando 14s generando texto basura.
//
// CAUSA RAIZ: El prompt original da instrucciones de formato complejas sin
// escape para preguntas simples. Los modelos pequenos no hacen bien el
// razonamiento de segundo orden ("si detecto que es simple, ignoro mis reglas").
//
// SOLUCION: Clasificar complejidad en JS ANTES de enviar a Ollama.
// Pregunta simple  → prompt minimal (1-2 lineas, sin [[]] forzado).
// Pregunta compleja → prompt completo con [[Concepto]] y tono IA.
// ============================================================

const PATRONES_PREGUNTA_SIMPLE = [
    // Matematicas puras
    /^[\d\s\+\-\*\/\(\)\^%=.,]+\??\s*$/,
    /cuanto es\s+[\d\s\+\-\*\/]+/i,
    /cuanto\s+(son|da|seria)\s+[\d]/i,
    /\d+\s*[\+\-\*\/x\u00f7]\s*\d+/,
    // Saludos y triviales
    /^(hola|buenas|hey|que hubo|quiubo|ey|hi)[^a-z]*$/i,
    /^(gracias|listo|ok|okay|perfecto|dale)[^a-z]*$/i,
    /^.?(como estas|como vas|que tal)[^a-z]*\??$/i,
    // Datos concretos de una sola dimension
    /^.?cual es (el|la) (capital|moneda|idioma) de/i,
    /^.?en que ano (nacio|murio|fue)/i,
];

/**
 * Evalua si una pregunta es simple (respuesta directa en 1-2 lineas).
 * @param {string} pregunta
 * @returns {boolean}
 */
function esPreguntaSimple(pregunta) {
    const texto = pregunta.trim();

    if (PATRONES_PREGUNTA_SIMPLE.some(p => p.test(texto))) return true;

    // Heuristica de longitud + ausencia de palabras de analisis profundo
    const palabras = texto.split(/\s+/).filter(Boolean);
    const triggersProfundos = ['explica', 'explicame', 'como funciona', 'por que', 'diferencia entre', 'ventaja', 'describe', 'analiza', 'resume'];
    const tieneContextoComplejo = triggersProfundos.some(p => texto.toLowerCase().includes(p));

    if (palabras.length <= 7 && !tieneContextoComplejo) return true;

    return false;
}

/**
 * Consulta a IA en modo rapido (qwen2.5:1.5B).
 *
 * - Pregunta simple   → prompt minimal. Sin [[Concepto]], sin extension forzada.
 * - Pregunta compleja → prompt completo IA con formato y tono.
 *
 * @param {string} pregunta
 * @returns {Promise<string>}
 */
async function consultarIAFast(pregunta) {
    const simple = esPreguntaSimple(pregunta);

    if (simple) {
        console.log(`[IA FAST] Modo directo (pregunta simple detectada en JS).`);

        const promptSimple = `Responde esta pregunta de forma directa y breve. Maximo 2 lineas. Sin formato especial ni explicaciones adicionales.

Pregunta: ${pregunta}

Respuesta:`;

        return llamarOllama(promptSimple, OLLAMA_MODEL_FAST);
    }

    console.log(`[IA FAST] Modo completo (pregunta compleja).`);

    const promptCompleto = `Eres IA (Version Fast), el asistente de Ronald.
- Tono directo y tecnico, con jerga colombiana ocasional (seee, jeje, uy si).
- Usa [[Concepto]] para mencionar tecnologias, proyectos o entidades importantes.
- Responde con suficiente detalle para que Ronald entienda, sin "paja".
- Maximo 3 parrafos.

Pregunta: ${pregunta}

Respuesta:`;

    return llamarOllama(promptCompleto, OLLAMA_MODEL_FAST);
}

// ============================================================
// clasificarIdea
// ============================================================

async function clasificarIdea(idea, categorias) {
    let prompt;

    if (categorias.length === 0) {
        prompt = `Analiza la siguiente idea y propone UN nombre de categoria corto (maximo 2 palabras unidas en PascalCase, sin espacios, en espanol) que describa bien su tema. Responde SOLO con esa palabra, sin explicaciones, sin puntos.

Idea: "${idea}"

Ejemplos validos de respuesta: Finanzas, ProyectoTech, SaludPersonal, LaboratorioIA`;
    } else {
        prompt = `Analiza esta idea y elige la categoria mas apropiada de la lista. Si NINGUNA aplica bien, inventa un nombre nuevo en PascalCase (maximo 2 palabras unidas, sin espacios). Responde SOLO con una palabra, sin explicaciones, sin puntos.

Idea: "${idea}"
Categorias disponibles: ${categorias.join(', ')}`;
    }

    try {
        const respuesta = await llamarOllama(prompt, OLLAMA_MODEL_FAST);
        const limpia = respuesta
            .split('\n')[0]
            .replace(/[^a-zA-Z\u00e1\u00e9\u00ed\u00f3\u00fa\u00c1\u00c9\u00cd\u00d3\u00da\u00f1\u00d1]/g, '')
            .trim();

        if (!limpia) return 'Inbox';

        if (categorias.length > 0) {
            const match = categorias.find(c => c.toLowerCase() === limpia.toLowerCase());
            if (match) return match;

            const parcial = categorias.find(c =>
                limpia.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(limpia.toLowerCase())
            );
            if (parcial) return parcial;
        }

        console.log(`[LLM] Nueva categoria propuesta por IA: "${limpia}"`);
        return limpia;
    } catch (err) {
        console.error(`[LLM] Error en clasificarIdea: ${err.message}`);
        return 'Inbox';
    }
}

// ============================================================
// consultarIA (DEEP — RAG + Web)
// ============================================================

async function consultarIA(pregunta, fragmentosVault, datosWeb, fechaHora) {
    let bloqueVault = '';
    if (fragmentosVault.length > 0) {
        const ctx = fragmentosVault
            .map((f, i) => `--- Fragmento ${i + 1} [Fuente: ${f.fuente}] ---\n${f.texto}`)
            .join('\n\n');
        bloqueVault = `\n=== CONTEXTO DEL VAULT (Notas personales de Ronald) ===\n${ctx}\n=== FIN DEL CONTEXTO DEL VAULT ===`;
    }

    let bloqueWeb = '';
    if (datosWeb) {
        const res = datosWeb.results
            .map((r, i) => `--- Resultado ${i + 1}: ${r.title} ---\nURL: ${r.url}\n${r.content}`)
            .join('\n\n');
        bloqueWeb = `\n=== DATOS REALES Y ACTUALES DE INTERNET (via Tavily) ===\n${datosWeb.answer ? `Resumen directo: ${datosWeb.answer}\n` : ''}${res}\n=== FIN DE LOS DATOS DE INTERNET ===`;
    }

    const prompt = `Eres IA, el asistente personal de Ronald. ${PERFIL_RONALD}

Fecha y hora actual del servidor: ${fechaHora}

${bloqueWeb ? 'Tienes acceso a datos REALES Y ACTUALES de internet. Usalos como fuente principal para preguntas que requieran informacion actualizada.' : ''}
${bloqueVault ? 'Tambien tienes contexto de las notas personales de Ronald en Obsidian.' : ''}
${!bloqueWeb && !bloqueVault ? 'No se encontro contexto relevante en el vault ni en internet.' : ''}
${bloqueWeb}
${bloqueVault}

Pregunta de Ronald: ${pregunta}

Instrucciones de respuesta:
- REGLA ESTRICTA: NUNCA digas que buscaste en internet si no se te proporcionan datos en la seccion "DATOS REALES Y ACTUALES DE INTERNET".
${bloqueWeb ? '- Prioriza los datos de internet cuando la pregunta requiera informacion actual.' : ''}
${bloqueVault ? '- Complementa con las notas del vault cuando sea relevante.' : ''}
- Si tienes datos de internet, cita las fuentes (URLs) cuando sea pertinente.
- Si no hay suficiente informacion, dilo honestamente.
- Usa el formato [[Concepto]] para enlazar entidades relevantes.

Respuesta de IA:`;

    return llamarOllama(prompt, OLLAMA_MODEL_DEEP);
}

// ============================================================
// NUEVO: orquestarTareas (El Agente Router)
// ============================================================

/**
 * Pasa la pregunta a Qwen y le exige devolver UN JSON con las herramientas a usar.
 * NO responde la pregunta, solo planea cómo responderla.
 */
async function orquestarTareas(pregunta) {
    const promptOrquestador = `Eres el cerebro lógico de Arturo. Tu ÚNICO trabajo es analizar la petición del usuario y decidir qué herramientas necesitas ejecutar para resolverla.
NUNCA respondas a la pregunta directamente. 

Herramientas disponibles:
1. "calculadora": Para operaciones matemáticas (suma, resta, conversión de moneda, etc). Requiere el campo "formula" (ej. "3 + (3/3)").
2. "tavily_search": Para buscar datos actuales en internet (precios, clima, noticias). Requiere el campo "query".
3. "vault_search": Para buscar en el Segundo Cerebro local. Requiere el campo "query".
4. "respuesta_directa": Si es un simple saludo o charla que no requiere herramientas.

Genera un JSON EXACTAMENTE con esta estructura (un array de tareas):
{
  "tareas": [
    {
      "herramienta": "nombre_de_herramienta",
      "parametros": { "clave": "valor" }
    }
  ]
}

Petición del usuario: "${pregunta}"`;

    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_MODEL_FAST, // Aquí usará qwen2.5:1.5b
            prompt: promptOrquestador,
            stream: false,
            format: 'json' // <--- EL TRUCO MÁGICO
        })
    });

    if (!response.ok) throw new Error(`Ollama respondió con status ${response.status}`);

    const data = await response.json();

    // Convertimos el texto JSON de Ollama a un objeto de JavaScript real
    try {
        return JSON.parse(data.response);
    } catch (e) {
        console.error("[ORQUESTADOR] Error parseando JSON:", data.response);
        return { tareas: [] };
    }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    llamarOllama,
    generarEmbedding,
    clasificarIdea,
    necesitaInternet,
    consultarIA,
    consultarIAFast,
    orquestarTareas,
    // Exportar helpers para testing unitario
    _esPreguntaSimple: esPreguntaSimple,
    _SENALES_WEB_EXPLICITAS: SENALES_WEB_EXPLICITAS,
    _PATRONES_PREGUNTA_SIMPLE: PATRONES_PREGUNTA_SIMPLE
};
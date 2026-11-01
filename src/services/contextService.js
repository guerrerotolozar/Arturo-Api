/**
 * src/services/contextService.js — Auto-contexto para Arturo V9.
 *
 * Antes de cada pregunta, busca en PARALELO:
 *   1. Memoria (LanceDB) — notas relevantes de la Bóveda
 *   2. Web (Tavily basic) — contexto fresco de internet
 *
 * Ambos se inyectan como bloques de texto antes del orquestador,
 * eliminando la dependencia del LLM para "decidir" si buscar.
 */

const { buscarSemanticamente, estaDisponible } = require('../repositories/vectorRepository');
const { buscarEnWeb } = require('../adapters/tavilyAdapter');
const { TAVILY_API_KEY } = require('../config/env');

// Umbral mínimo de similitud para inyectar un fragmento de memoria.
// LanceDB devuelve distancia (0 = idéntico). Similitud = 1 - distancia.
// 0.25 = "algo relacionado". Por debajo, es ruido.
const UMBRAL_SIMILITUD = 0.25;

// Máximo de fragmentos de memoria a inyectar
const MAX_FRAGMENTOS_MEMORIA = 3;

// Máximo de resultados web a inyectar
const MAX_RESULTADOS_WEB = 3;

/**
 * Determina si una pregunta necesita contexto web.
 * Evita gastar créditos de Tavily en saludos o comandos locales.
 */
function necesitaContextoWeb(pregunta) {
    const limpia = pregunta.trim().toLowerCase();
    const palabras = limpia.split(/\s+/).length;

    // Demasiado corta = probablemente saludo o confirmación
    if (palabras <= 3) return false;

    // Comandos locales explícitos (vault operations, organización)
    const patronesLocales = [
        /^(mueve|mover|organiza|limpia|borra|elimina|crea una nota)/i,
        /^(anota|guarda|apunta)/i,
        /\b(vault|bóveda|cerebro|inbox|carpeta)\b/i,
        /\b(audita|auditoría|código|api_code|backend)\b/i,
    ];
    if (patronesLocales.some(p => p.test(limpia))) return false;

    // Si ya trae contexto visual/video inyectado, no buscar web
    if (limpia.includes('[el usuario adjuntó') || limpia.includes('[contexto visual')) return false;

    return true;
}

/**
 * Busca memoria relevante en LanceDB.
 * @param {string} pregunta
 * @returns {Promise<string>} Bloque de contexto o string vacío
 */
async function buscarMemoria(pregunta) {
    try {
        const disponible = await estaDisponible();
        if (!disponible) return '';

        const resultados = await buscarSemanticamente(pregunta, MAX_FRAGMENTOS_MEMORIA, []);

        // Filtrar por umbral de similitud
        const relevantes = resultados.filter(r => {
            const similitud = 1 - (r.distancia || 0);
            return similitud >= UMBRAL_SIMILITUD;
        });

        if (relevantes.length === 0) return '';

        const fragmentos = relevantes.map(r => {
            const fuente = r.metadata?.fuente || 'Desconocido';
            const similitud = (1 - (r.distancia || 0)).toFixed(2);
            return `- [${fuente}] (sim: ${similitud}): ${r.texto.substring(0, 400)}`;
        }).join('\n');

        return `[MEMORIA DEL CEREBRO (auto-recuperada)]:\n${fragmentos}`;
    } catch (err) {
        console.warn(`[CONTEXTO] Error buscando memoria: ${err.message}`);
        return '';
    }
}

/**
 * Busca contexto web fresco en Tavily (modo basic = 1 crédito).
 * @param {string} pregunta
 * @returns {Promise<string>} Bloque de contexto o string vacío
 */
async function buscarContextoWeb(pregunta) {
    try {
        if (!TAVILY_API_KEY) return '';

        const web = await buscarEnWeb(pregunta, 'basic');

        if (!web.results || web.results.length === 0) return '';

        const resultados = web.results.slice(0, MAX_RESULTADOS_WEB)
            .map(r => `- [${r.title}] ${r.content.substring(0, 300)}`)
            .join('\n');

        const respuesta = web.answer ? `Resumen: ${web.answer}\n` : '';

        return `[CONTEXTO WEB ACTUAL (auto-buscado)]:\n${respuesta}${resultados}`;
    } catch (err) {
        console.warn(`[CONTEXTO] Error buscando web: ${err.message}`);
        return '';
    }
}

/**
 * Recopila contexto automático (memoria + web) en paralelo.
 *
 * @param {string} pregunta - La pregunta del usuario
 * @returns {Promise<{memoria: string, web: string}>}
 */
async function enriquecerConContexto(pregunta) {
    const tareas = [buscarMemoria(pregunta)];

    // Solo buscar web si la pregunta lo amerita
    if (necesitaContextoWeb(pregunta)) {
        tareas.push(buscarContextoWeb(pregunta));
    } else {
        tareas.push(Promise.resolve(''));
    }

    const [memoriaResult, webResult] = await Promise.allSettled(tareas);

    const memoria = memoriaResult.status === 'fulfilled' ? memoriaResult.value : '';
    const web = webResult.status === 'fulfilled' ? webResult.value : '';

    // Log de diagnóstico
    const fragsMem = memoria ? memoria.split('\n-').length - 1 : 0;
    const fragsWeb = web ? web.split('\n-').length - 1 : 0;
    if (fragsMem > 0 || fragsWeb > 0) {
        console.log(`[CONTEXTO] Memoria: ${fragsMem} fragmentos | Web: ${fragsWeb} resultados`);
    }

    return { memoria, web };
}

/**
 * Construye la pregunta enriquecida con el contexto automático.
 *
 * @param {string} pregunta - Pregunta original
 * @param {{memoria: string, web: string}} contexto
 * @returns {string} Pregunta con contexto inyectado
 */
function inyectarContexto(pregunta, contexto) {
    const bloques = [];

    if (contexto.memoria) bloques.push(contexto.memoria);
    if (contexto.web) bloques.push(contexto.web);

    if (bloques.length === 0) return pregunta;

    return `${bloques.join('\n\n')}\n\nPetición de Ronald: ${pregunta}`;
}

module.exports = {
    enriquecerConContexto,
    inyectarContexto,
    necesitaContextoWeb
};

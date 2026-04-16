/**
 * Controlador de IA — Consulta RAG + Web híbrida.
 * Ruta: POST /IA/consultar
 * Motor: llama3.1 (DEEP) — Procesamiento profundo de contexto.
 */

const { necesitaInternet, consultarIA } = require('../services/llmService');
const { buscarContexto } = require('../services/vaultService');
const { buscarEnWeb } = require('../services/searchService');
const { obtenerFechaHoraLocal } = require('../utils/dateUtils');

/**
 * Handler para POST /IA/consultar
 * Orquesta: intención → vault → web → LLM → respuesta.
 */
async function consultaIA(req, res) {
    const { pregunta } = req.body;

    if (!pregunta || pregunta.trim().length === 0) {
        return res.status(400).json({
            error: 'Falta la pregunta, Ronald. Envía { "pregunta": "Tu pregunta aquí" }'
        });
    }

    console.log(`[IA] Consulta recibida: "${pregunta}"`);

    try {
        // PASO 1: Detectar intención — ¿Necesita internet? (con llama3.1)
        const quiereWeb = await necesitaInternet(pregunta);

        // PASO 2: Buscar contexto en el vault (siempre)
        const fragmentosVault = await buscarContexto(pregunta);
        console.log(`[IA] ${fragmentosVault.length} fragmentos del vault encontrados`);

        // PASO 3: Buscar en internet (si Arturo lo decidió)
        let datosWeb = null;
        if (quiereWeb) {
            try {
                datosWeb = await buscarEnWeb(pregunta);
                console.log(`[IA] Datos web obtenidos: ${datosWeb.results.length} resultados`);
            } catch (webErr) {
                console.warn(`[IA] Búsqueda web falló: ${webErr.message}. Continuando sin web.`);
            }
        }

        // PASO 4: Si no hay contexto de ningún lado, avisar
        if (fragmentosVault.length === 0 && !datosWeb) {
            return res.status(200).json({
                pregunta: pregunta,
                respuesta: 'No encontré notas relevantes en tu vault ni pude obtener datos de internet para responder esa pregunta. ¿Quieres que cree una nota nueva sobre ese tema?',
                fuentes_vault: [],
                fuentes_web: [],
                contexto_encontrado: false,
                busco_en_web: quiereWeb
            });
        }

        // PASO 5: Consultar a Ollama con el contexto híbrido usando modelo profundo
        const fechaHora = obtenerFechaHoraLocal();
        const respuesta = await consultarIA(pregunta, fragmentosVault, datosWeb, fechaHora);

        // PASO 6: Respuesta estructurada
        res.status(200).json({
            pregunta: pregunta,
            respuesta: respuesta,
            fuentes_vault: fragmentosVault.map(f => ({
                nota: f.fuente,
                relevancia: f.score
            })),
            fuentes_web: datosWeb ? datosWeb.results.map(r => ({
                titulo: r.title,
                url: r.url
            })) : [],
            contexto_encontrado: true,
            busco_en_web: quiereWeb,
            fragmentos_vault_usados: fragmentosVault.length,
            resultados_web_usados: datosWeb ? datosWeb.results.length : 0,
            timestamp: fechaHora
        });

        console.log(`[IA] Respuesta entregada exitosamente (web: ${quiereWeb})`);

    } catch (err) {
        console.error(`[IA ERROR] ${err.message}`);

        // Diferenciar errores de Ollama vs Tavily vs otros
        if (err.message.includes('Ollama') || err.message.includes('fetch')) {
            return res.status(503).json({
                error: 'Ollama no está respondiendo. ¿Está corriendo el servicio?',
                detalle: err.message
            });
        }

        if (err.message.includes('Tavily')) {
            return res.status(503).json({
                error: 'Tavily no está respondiendo. ¿La API key está configurada?',
                detalle: err.message
            });
        }

        res.status(500).json({
            error: 'Algo falló internamente, Ronald.',
            detalle: err.message
        });
    }
}

module.exports = consultaIA;

/**
 * consultaHibridaUseCase.js
 * Antes: 6 pasos en IA.js (fat controller).
 * Ahora: lógica de negocio aislada, sin req/res.
 */
const { necesitaInternet, consultarIA } = require('../services/llmService');
const { buscarContexto }                = require('../services/ragService');
const { buscarEnWeb }                   = require('../adapters/tavilyAdapter');
const { obtenerFechaHoraLocal }         = require('../utils/dateUtils');

/**
 * @param {string} pregunta
 * @returns {Promise<{respuesta, fuentesVault, fuentesWeb, buscoWeb, contextoEncontrado, timestamp}>}
 */
async function consultaHibrida(pregunta) {
    const quiereWeb       = await necesitaInternet(pregunta);
    const fragmentosVault = await buscarContexto(pregunta);
    console.log(`[HIBRIDA] ${fragmentosVault.length} fragmentos vault | web: ${quiereWeb}`);

    let datosWeb = null;
    if (quiereWeb) {
        try {
            datosWeb = await buscarEnWeb(pregunta);
        } catch (e) {
            console.warn(`[HIBRIDA] Web falló: ${e.message}. Continuando sin web.`);
        }
    }

    const sinContexto = fragmentosVault.length === 0 && !datosWeb;
    if (sinContexto) {
        return {
            respuesta: 'No encontré notas relevantes ni datos de internet. ¿Creamos una nota nueva sobre el tema?',
            fuentesVault: [], fuentesWeb: [],
            buscoWeb: quiereWeb, contextoEncontrado: false,
            timestamp: obtenerFechaHoraLocal()
        };
    }

    const fechaHora = obtenerFechaHoraLocal();
    const respuesta = await consultarIA(pregunta, fragmentosVault, datosWeb, fechaHora);

    return {
        respuesta,
        fuentesVault: fragmentosVault.map(f => ({ nota: f.fuente, relevancia: f.score })),
        fuentesWeb:   datosWeb ? datosWeb.results.map(r => ({ titulo: r.title, url: r.url })) : [],
        buscoWeb:     quiereWeb,
        contextoEncontrado: true,
        fragmentosVaultUsados: fragmentosVault.length,
        resultadosWebUsados:   datosWeb ? datosWeb.results.length : 0,
        timestamp: fechaHora
    };
}

module.exports = { consultaHibrida };
/**
 * src/tools/vaultAppendTool.js — Escritura inteligente al Segundo Cerebro.
 *
 * Refactorizado a Clean Architecture: La herramienta actúa únicamente como un
 * enrutador, delegando la heurística y la lógica pesada al caso de uso correspondiente.
 */

const { anexarInformacionBoveda } = require('../use-cases/anexarBovedaUseCase');

module.exports = {
    nombre: 'vault_append',
    descripcion: `ANOTA, GUARDA o AGREGA informacion nueva al Segundo Cerebro de Ronald. `
        + `Usa esta herramienta cuando el usuario diga "anota", "guarda", "agrega", "apunta", "recuerda que..." `
        + `Parametros: "query" (tema o nombre de la nota destino, ej "torre", "suscripciones", "laptop"), `
        + `"contenido" (el texto a agregar). `
        + `Si el usuario no dice donde guardar, infiere el tema del contenido y ponlo en "query". `
        + `El contenido se agrega AL FINAL de la nota, nunca sobreescribe.`,

    async ejecutar(params, onProgress = () => {}) {
        const query = (params.query || params.nota || '').trim();
        const contenido = params.contenido;

        if (!query || !contenido) {
            return {
                resumen: `Error: faltan parámetros. Necesito "query" (tema/nota) y "contenido" (lo que se va a anotar).`,
                datos: { exito: false }
            };
        }

        try {
            return await anexarInformacionBoveda(query, contenido, onProgress);
        } catch (error) {
            console.error(`[VAULT_APPEND_TOOL] Error: ${error.message}`);
            return {
                resumen: `Error del sistema al intentar guardar en la bóveda: ${error.message}`,
                datos: { exito: false, error: error.message }
            };
        }
    }
};

/**
 * src/tools/vaultMoveTool.js — Herramienta para ORGANIZAR el vault.
 * Permite a Arturo mover o renombrar archivos para mantener la boveda limpia.
 */

const path = require('path');
const fs = require('fs');
const { VAULT_PATH, asegurarDirectorio } = require('../repositories/vaultRepository');

module.exports = {
    nombre: 'vault_move',
    descripcion: `MUEVE o ORGANIZA archivos dentro del vault. `
        + `Usa esta herramienta cuando el usuario pida "organiza", "mueve", "pasa esto a la carpeta X". `
        + `Parametros: "origen" (nombre o ruta de la nota actual, ej: "nota.md"), `
        + `"destino" (ruta nueva relativa a la boveda, ej: "Boveda/Finanzas/nota.md").`,

    async ejecutar(params) {
        const origen = params.origen || params.archivo;
        const destino = params.destino || params.ruta_nueva;

        if (!origen || !destino) {
            return { resumen: "Error: falta 'origen' y 'destino'.", datos: { exito: false } };
        }

        // Seguridad Pro: Resolución absoluta y prevención de Path Traversal
        const rutaAbsOrigen = path.resolve(VAULT_PATH, origen);
        const rutaAbsDestino = path.resolve(VAULT_PATH, destino);

        // Validar matemáticamente que no se escape de la Bóveda
        if (!rutaAbsOrigen.startsWith(path.resolve(VAULT_PATH)) || !rutaAbsDestino.startsWith(path.resolve(VAULT_PATH))) {
            return { resumen: "Error de seguridad: Intento de acceso fuera de la Bóveda.", datos: { exito: false } };
        }

        if (!fs.existsSync(rutaAbsOrigen)) {
            return { resumen: `No encontré el archivo "${origen}" para moverlo.`, datos: { exito: false } };
        }

        try {
            // Asegurar que la carpeta de destino existe
            asegurarDirectorio(path.dirname(rutaAbsDestino));
            
            // Mover el archivo
            fs.renameSync(rutaAbsOrigen, rutaAbsDestino);
            
            console.log(`[TOOL vault_move] Moviendo: ${origen} -> ${destino}`);
            
            return {
                resumen: `Listo, moví [[${path.basename(origen)}]] a la ubicación: ${destino}.`,
                datos: { exito: true, de: origen, a: destino }
            };
        } catch (err) {
            console.error(`[TOOL vault_move] Error:`, err.message);
            return { resumen: `Error al mover el archivo: ${err.message}`, datos: { exito: false } };
        }
    }
};

/**
 * src/tools/vaultBulkMoveTool.js
 * Herramienta para ORGANIZAR la bóveda masivamente (Bulk).
 */

const path = require('path');
const fs = require('fs');
const { VAULT_PATH, asegurarDirectorio } = require('../repositories/vaultRepository');

module.exports = {
    nombre: 'vault_bulk_move',
    descripcion: `Mueve o COPIA múltiples archivos en lote. Útil para reestructuraciones masivas de la bóveda. `
        + `Parámetros: "movimientos" (arreglo estricto de objetos {origen: "ruta.md", destino: "nueva_ruta.md"}), `
        + `"modo_copia" (booleano, true para clonar sin borrar el original, false para mover). `
        + `IMPORTANTE: Para simulaciones o pruebas, usa SIEMPRE modo_copia: true y asegúrate de que el destino inicie con "Boveda/boveda_test/".`,

    async ejecutar(params) {
        const movimientos = params.movimientos || [];
        const modoCopia = params.modo_copia === true || String(params.modo_copia) === "true";

        if (!Array.isArray(movimientos) || movimientos.length === 0) {
            return { resumen: "Error: falta el arreglo 'movimientos' o está vacío.", datos: { exito: false } };
        }

        console.log(`[TOOL vault_bulk_move] Iniciando operación masiva (${movimientos.length} archivos). Modo copia: ${modoCopia}`);

        const resultados = {
            exitosos: 0,
            fallidos: 0,
            detalles: []
        };

        for (const mov of movimientos) {
            if (!mov.origen || !mov.destino) {
                resultados.fallidos++;
                resultados.detalles.push({ archivo: mov.origen || '?', error: "Origen o destino vacío" });
                continue;
            }

            // Limpiar rutas
            const origenLimpio = mov.origen.replace(/^[/\\]+/, '');
            const destinoLimpio = mov.destino.replace(/^[/\\]+/, '');

            const rutaAbsOrigen = path.resolve(VAULT_PATH, origenLimpio);
            const rutaAbsDestino = path.resolve(VAULT_PATH, destinoLimpio);

            // Validar Path Traversal
            if (!rutaAbsOrigen.startsWith(path.resolve(VAULT_PATH)) || !rutaAbsDestino.startsWith(path.resolve(VAULT_PATH))) {
                resultados.fallidos++;
                resultados.detalles.push({ archivo: origenLimpio, error: "Intento de acceso fuera de la bóveda (Path Traversal)" });
                continue;
            }

            if (!fs.existsSync(rutaAbsOrigen)) {
                resultados.fallidos++;
                resultados.detalles.push({ archivo: origenLimpio, error: "El archivo origen no existe" });
                continue;
            }

            try {
                // Asegurar carpeta destino
                asegurarDirectorio(path.dirname(rutaAbsDestino));

                if (modoCopia) {
                    fs.copyFileSync(rutaAbsOrigen, rutaAbsDestino);
                } else {
                    fs.renameSync(rutaAbsOrigen, rutaAbsDestino);
                }

                resultados.exitosos++;
                resultados.detalles.push({ archivo: origenLimpio, destino: destinoLimpio, exito: true });
            } catch (err) {
                resultados.fallidos++;
                resultados.detalles.push({ archivo: origenLimpio, error: err.message });
            }
        }

        const accion = modoCopia ? 'copiados' : 'movidos';
        const resumen = `Operación masiva completada. ${resultados.exitosos} archivos ${accion} exitosamente. ${resultados.fallidos} fallaron.`;
        console.log(`[TOOL vault_bulk_move] ${resumen}`);

        return {
            resumen: resumen + (resultados.fallidos > 0 ? " Revisa los detalles para ver qué falló." : ""),
            datos: resultados
        };
    }
};

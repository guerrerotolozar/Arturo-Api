/**
 * src/tools/vaultListTool.js — Le da a Arturo la capacidad de VER la estructura del cerebro.
 *
 * Antes, Arturo solo podía BUSCAR texto (vault_search) pero no podía VER
 * el mapa de carpetas y archivos. Era como ordenar una bodega con los ojos vendados.
 *
 * Esta herramienta le muestra el árbol de directorios completo:
 *   📁 Boveda/
 *     📁 Finanzas/
 *       📄 Suscripciones.md
 *       📄 Gastos Abril.md
 *     📁 Hardware/
 *       📄 RTX 5060.md
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH } = require('../repositories/vaultRepository');

module.exports = {
    nombre: 'vault_list',
    descripcion: 'Muestra el MAPA COMPLETO de carpetas y archivos del Segundo Cerebro. '
        + 'Usa esta herramienta ANTES de organizar, mover o diagnosticar la estructura. '
        + 'Parametro opcional: "carpeta" para listar solo una subcarpeta (ej: "Boveda/Finanzas"). '
        + 'Si no se pasa carpeta, muestra TODO el cerebro.',

    async ejecutar(params = {}) {
        const carpetaRelativa = (params.carpeta || '').replace(/^[/\\]+/, '');
        const dirBase = carpetaRelativa 
            ? path.resolve(VAULT_PATH, carpetaRelativa) 
            : VAULT_PATH;

        // Seguridad: no escapar del vault
        if (!dirBase.startsWith(path.resolve(VAULT_PATH))) {
            return { resumen: 'Error de seguridad: ruta fuera de la Bóveda.', datos: { exito: false } };
        }

        if (!fs.existsSync(dirBase)) {
            return { 
                resumen: `La carpeta "${carpetaRelativa || 'raíz'}" no existe en el cerebro.`, 
                datos: { exito: false } 
            };
        }

        const arbol = [];
        let totalArchivos = 0;
        let totalCarpetas = 0;

        function escanear(dir, profundidad = 0) {
            // Limitar profundidad para no sobrecargar el contexto del LLM
            if (profundidad > 4) return;

            try {
                const entradas = fs.readdirSync(dir, { withFileTypes: true })
                    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
                    .sort((a, b) => {
                        // Carpetas primero, luego archivos
                        if (a.isDirectory() && !b.isDirectory()) return -1;
                        if (!a.isDirectory() && b.isDirectory()) return 1;
                        return a.name.localeCompare(b.name);
                    });

                for (const entrada of entradas) {
                    const indent = '  '.repeat(profundidad);
                    if (entrada.isDirectory()) {
                        totalCarpetas++;
                        arbol.push(`${indent}📁 ${entrada.name}/`);
                        escanear(path.join(dir, entrada.name), profundidad + 1);
                    } else if (entrada.name.endsWith('.md')) {
                        totalArchivos++;
                        arbol.push(`${indent}📄 ${entrada.name}`);
                    }
                }
            } catch { /* carpeta inaccesible */ }
        }

        escanear(dirBase);

        const resumen = `Estructura del Cerebro${carpetaRelativa ? ` (${carpetaRelativa})` : ''}:\n`
            + `${totalCarpetas} carpetas, ${totalArchivos} notas\n\n`
            + arbol.join('\n');

        console.log(`[TOOL vault_list] Escaneado: ${totalCarpetas} carpetas, ${totalArchivos} archivos`);

        return { 
            resumen, 
            datos: { exito: true, carpetas: totalCarpetas, archivos: totalArchivos } 
        };
    }
};

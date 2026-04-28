/**
 * src/tools/index.js — Tool Registry con auto-scan.
 *
 * PATRON OCP (Open/Closed Principle):
 *   Para agregar una herramienta nueva al agente:
 *     1. Crear src/tools/miHerramientaTool.js con {nombre, descripcion, ejecutar}
 *     2. Listo. Cero cambios en controllers, use-cases ni llmService.
 *
 * Contrato que debe cumplir cada tool:
 *   - nombre:      string  — identificador único que el LLM pondrá en el JSON
 *   - descripcion: string  — descripción para el prompt del orquestador
 *   - ejecutar:    async (params) => { resumen: string, datos?: any }
 */

const fs   = require('fs');
const path = require('path');

// Auto-scan: carga todos los archivos que terminan en "Tool.js" en esta carpeta.
// No hay lista hardcodeada. Agrega un archivo → se registra solo.
const tools = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('Tool.js'))
    .map(f => {
        const tool = require(path.join(__dirname, f));
        // Validar contrato mínimo
        if (!tool.nombre || !tool.descripcion || typeof tool.ejecutar !== 'function') {
            console.warn(`[TOOLS] ${f} no cumple el contrato {nombre, descripcion, ejecutar}. Ignorando.`);
            return null;
        }
        return tool;
        return tool;
    })
    .filter(Boolean);

console.log(`[TOOLS] 🛠️  ${tools.length} herramientas cargadas correctamente en el Agente.`);

// Mapa para lookup O(1) por nombre
const toolMap = new Map(tools.map(t => [t.nombre, t]));

/**
 * Genera la descripción de herramientas para el prompt del orquestador.
 * Se actualiza automáticamente cuando se agrega una tool nueva.
 * @returns {string}
 */
function generarDescripcionHerramientas() {
    return tools
        .map((t, i) => `${i + 1}. "${t.nombre}": ${t.descripcion}`)
        .join('\n');
}

module.exports = { tools, toolMap, generarDescripcionHerramientas };
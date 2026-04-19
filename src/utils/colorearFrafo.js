const fs = require('fs');
const path = require('path');
const { VAULT_PATH_BOVEDA } = require('../config/env');

// Ruta al archivo de configuración del grafo de Obsidian
const graphPath = path.join(VAULT_PATH_BOVEDA, '.obsidian', 'graph.json');

// 1. Obtener todas las carpetas principales (ignorando las ocultas como .obsidian)
const carpetas = fs.readdirSync(VAULT_PATH_BOVEDA, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

// 2. Leer la configuración actual del grafo (o crearla si no existe)
let graph = {};
if (fs.existsSync(graphPath)) {
    try {
        graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    } catch (e) {
        console.warn('El graph.json estaba malformado. Se creará uno nuevo.');
    }
}

// 3. Asignar colores fijos y vibrantes (Neón)
const paletaNeon = [
    0xFF3366, // Rosa neón
    0x00FFCC, // Cyan
    0xFFCC00, // Amarillo
    0x9933FF, // Morado
    0x33CC33, // Verde brillante
    0xFF6600, // Naranja
    0x0066FF, // Azul fuerte
    0xFF99CC  // Rosa claro
];

graph.colorGroups = carpetas.map((carpeta, index) => {
    // Usamos el índice para sacar un color de la paleta. Si hay más carpetas que colores, reinicia.
    const colorInt = paletaNeon[index % paletaNeon.length];

    return {
        query: `path:"${carpeta}"`,
        color: { a: 1, rgb: colorInt }
    };
});

// 4. Guardar los cambios
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
console.log(`\n[ÉXITO] Se asignaron colores VIBRANTES a ${carpetas.length} carpetas.`);
console.log(`Ya puede abrir Obsidian en Windows.\n`);
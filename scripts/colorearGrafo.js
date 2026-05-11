const fs = require('fs');
const path = require('path');
const { VAULT_PATH_BOVEDA } = require('../src/config/env');

// Ruta al archivo de configuración del grafo de Obsidian
const graphPath = path.join(VAULT_PATH_BOVEDA, '.obsidian', 'graph.json');

if (!VAULT_PATH_BOVEDA || !fs.existsSync(VAULT_PATH_BOVEDA)) {
    console.error(`[ERROR] No se pudo encontrar la bóveda en: ${VAULT_PATH_BOVEDA}`);
    process.exit(1);
}

/**
 * Función recursiva para obtener todas las carpetas y subcarpetas
 */
function obtenerTodasLasCarpetas(dir, base = '', lista = []) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
            const nombreRelativo = base ? `${base}/${item.name}` : item.name;
            lista.push(nombreRelativo);
            obtenerTodasLasCarpetas(path.join(dir, item.name), nombreRelativo, lista);
        }
    }
    return lista;
}

/**
 * Genera un color entero (RGB) basado en un string (Hash-to-Color)
 * Esto asegura colores únicos y consistentes sin una paleta limitada.
 */
function generarColorPorHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Convertir hash a HSL (Hue, Saturation, Lightness)
    const h = Math.abs(hash % 360);
    const s = 0.75; // 75% saturación para colores vivos
    const l = 0.55; // 55% luminosidad (ni muy oscuro ni muy claro)

    // Convertir HSL a RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const resR = Math.round((r + m) * 255);
    const resG = Math.round((g + m) * 255);
    const resB = Math.round((b + m) * 255);

    return (resR << 16) | (resG << 8) | resB;
}

console.log("🔍 Escaneando bóveda...");

// 1. Obtener todas las carpetas
let carpetas = obtenerTodasLasCarpetas(VAULT_PATH_BOVEDA);

// 2. CRÍTICO: Ordenar por PROFUNDIDAD (más profundo primero)
// Esto permite que Obsidian aplique las reglas de subcarpetas ANTES que las de las carpetas padre.
carpetas.sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthB - depthA; // Más profundo primero
    return b.length - a.length; // En empate, el nombre más largo primero
});

// 3. Leer configuración
let graph = {};
if (fs.existsSync(graphPath)) {
    try {
        graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    } catch (e) {
        console.warn('El graph.json estaba malformado. Se creará uno nuevo.');
    }
}

// 4. Generar Grupos de Color con colores únicos por nombre
graph.colorGroups = carpetas.map(ruta => ({
    query: `path:"${ruta}"`,
    color: { a: 1, rgb: generarColorPorHash(ruta) }
}));

// 5. Guardar
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));

console.log(`\n[ÉXITO] 🧠 Grafo Inteligente Actualizado.`);
console.log(`- Carpetas procesadas: ${carpetas.length}`);
console.log(`- Ordenamiento: Profundidad Descendente (Priority Check)`);
console.log(`- Colores: Basados en Hash único por nombre.`);
console.log(`\nYa puede abrir Obsidian en Windows.\n`);
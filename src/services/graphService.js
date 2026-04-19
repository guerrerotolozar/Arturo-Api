/**
 * graphService.js — Lógica de grafos del vault.
 * Extraído de vaultService.js (ahora zombie).
 */
const path = require('path');
const { leerVaultRecursivo } = require('../repositories/vaultRepository');

function generarGrafoJSON() {
    const notas = leerVaultRecursivo();
    const nodes = [], links = [];
    const regex = /\[\[(.*?)\]\]/g;
    for (const nota of notas) {
        const dir   = path.dirname(nota.ruta).replace(/\\/g, '/');
        const grupo = (dir === '.' || dir === '/') ? 'Raiz' : dir.replace(/^\//, '');
        nodes.push({ id: nota.nombre, grupo });
        let m;
        while ((m = regex.exec(nota.contenido)) !== null)
            links.push({ source: nota.nombre, target: m[1].split('|')[0].trim() });
    }
    return { nodes, links };
}

function obtenerEstadisticasGrafo() {
    const { nodes, links } = generarGrafoJSON();
    const ent = {}, sal = {};
    for (const n of nodes) { ent[n.id] = 0; sal[n.id] = 0; }
    for (const l of links) {
        if (ent[l.target] !== undefined) ent[l.target]++;
        if (sal[l.source] !== undefined) sal[l.source]++;
    }
    return {
        total_nodos:   nodes.length,
        total_enlaces: links.length,
        hubs:     nodes.map(n => ({ id: n.id, entrantes: ent[n.id], salientes: sal[n.id] }))
                       .sort((a, b) => b.entrantes - a.entrantes).slice(0, 5),
        huerfanos: nodes.filter(n => ent[n.id] === 0 && sal[n.id] === 0).map(n => n.id),
        por_carpeta: nodes.reduce((acc, n) => ({ ...acc, [n.grupo]: (acc[n.grupo] || 0) + 1 }), {})
    };
}

module.exports = { 
    generarGrafoJSON, 
    obtenerEstadisticasGrafo 
};
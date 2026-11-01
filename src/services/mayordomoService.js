/**
 * src/services/mayordomoService.js
 * 
 * Gestiona el Perfil del Mayordomo para Media Intelligence.
 * Aprende de las categorizaciones manuales y mantiene un JSON
 * en el Cerebro que sirve como contexto para futuras predicciones.
 */

const fs = require('fs');
const path = require('path');
const { VAULT_PATH_BOVEDA } = require('../config/env');

// Ruta al archivo del perfil en la Bóveda
const MAYORDOMO_FILE = path.join(VAULT_PATH_BOVEDA, 'NUCLEO', 'mayordomo.json');

/**
 * Carga el perfil actual desde el disco.
 * Si no existe, devuelve una estructura limpia.
 */
function obtenerPerfil() {
    if (!fs.existsSync(MAYORDOMO_FILE)) {
        return {
            perfil_actualizado: new Date().toISOString().split('T')[0],
            categorias_descubiertas: {}
        };
    }
    try {
        const data = fs.readFileSync(MAYORDOMO_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('[MAYORDOMO] Error leyendo perfil:', err.message);
        return { perfil_actualizado: new Date().toISOString().split('T')[0], categorias_descubiertas: {} };
    }
}

/**
 * Guarda el perfil en el disco.
 */
function guardarPerfil(perfil) {
    try {
        const dir = path.dirname(MAYORDOMO_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        perfil.perfil_actualizado = new Date().toISOString().split('T')[0];
        fs.writeFileSync(MAYORDOMO_FILE, JSON.stringify(perfil, null, 2), 'utf8');
    } catch (err) {
        console.error('[MAYORDOMO] Error guardando perfil:', err.message);
    }
}

/**
 * Arturo aprende de una categorización que hizo el usuario.
 * @param {string[]} categorias - Array de categorías asignadas a un video.
 */
function aprenderDeCategorizacion(categorias) {
    if (!categorias || categorias.length === 0) return;

    const perfil = obtenerPerfil();
    const hoy = new Date().toISOString().split('T')[0];
    let cambios = false;

    for (let cat of categorias) {
        // Normalizamos la categoría (Title Case simple)
        cat = cat.trim().charAt(0).toUpperCase() + cat.trim().slice(1).toLowerCase();
        
        if (!perfil.categorias_descubiertas[cat]) {
            // Categoría nueva
            perfil.categorias_descubiertas[cat] = {
                creada: hoy,
                videos: 1,
                confianza: 0.5 // Empieza con confianza media
            };
            cambios = true;
            console.log(`[MAYORDOMO] 🧠 Nueva categoría aprendida: "${cat}"`);
        } else {
            // Categoría existente, reforzar confianza
            const info = perfil.categorias_descubiertas[cat];
            info.videos += 1;
            // La confianza sube asintóticamente hacia 0.99
            info.confianza = Math.min(0.99, info.confianza + 0.05);
            cambios = true;
            console.log(`[MAYORDOMO] 🧠 Categoría reforzada: "${cat}" (videos: ${info.videos})`);
        }
    }

    if (cambios) {
        guardarPerfil(perfil);
    }
}

/**
 * Devuelve un resumen de las categorías conocidas para inyectar en el prompt de la IA.
 * Filtra las que tienen muy baja confianza o pocos videos para evitar ruido.
 */
function obtenerContextoParaIA() {
    const perfil = obtenerPerfil();
    const categorias = Object.keys(perfil.categorias_descubiertas);
    
    if (categorias.length === 0) return "Aún no has descubierto categorías.";

    // Ordenar por cantidad de videos (las más usadas primero)
    const ordenadas = categorias.sort((a, b) => {
        return perfil.categorias_descubiertas[b].videos - perfil.categorias_descubiertas[a].videos;
    });

    return ordenadas.map(cat => {
        const info = perfil.categorias_descubiertas[cat];
        return `- ${cat} (usada en ${info.videos} videos)`;
    }).join('\n');
}

module.exports = {
    obtenerPerfil,
    aprenderDeCategorizacion,
    obtenerContextoParaIA
};

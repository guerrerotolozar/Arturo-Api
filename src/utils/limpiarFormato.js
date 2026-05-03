/**
 * src/utils/limpiarFormato.js — Filtro de limpieza de formato.
 *
 * Los modelos pequeños (4B) tienden a escupir LaTeX cuando hacen cálculos.
 * Este filtro garantiza que NADA de eso llegue al usuario final.
 *
 * Se aplica como última capa antes de enviar la respuesta por SSE.
 */

/**
 * Elimina artefactos de LaTeX y formato académico de una respuesta.
 * @param {string} texto - Respuesta cruda del LLM
 * @returns {string} - Respuesta limpia en markdown plano
 */
function limpiarFormato(texto) {
    if (!texto || typeof texto !== 'string') return texto;

    let limpio = texto;

    // ── 1. Bloques de ecuación completos: $$...$$  →  contenido limpio ──
    limpio = limpio.replace(/\$\$([\s\S]*?)\$\$/g, (_, contenido) => {
        return limpiarContenidoLatex(contenido.trim());
    });

    // ── 2. Inline math: $...$  →  contenido limpio ──
    //    Cuidado: no confundir con precios como "$850 COP"
    //    Solo matchea si el contenido tiene comandos LaTeX
    limpio = limpio.replace(/\$([^$]+?)\$/g, (match, contenido) => {
        if (/\\[a-zA-Z]/.test(contenido) || /[{}^_]/.test(contenido)) {
            return limpiarContenidoLatex(contenido);
        }
        return match; // Es un precio real, no tocar
    });

    // ── 3. Comandos LaTeX sueltos que se escaparon ──
    limpio = limpio.replace(/\\text\{([^}]*)\}/g, '$1');
    limpio = limpio.replace(/\\mathbf\{([^}]*)\}/g, '**$1**');
    limpio = limpio.replace(/\\textbf\{([^}]*)\}/g, '**$1**');
    limpio = limpio.replace(/\\textit\{([^}]*)\}/g, '*$1*');
    limpio = limpio.replace(/\\mathrm\{([^}]*)\}/g, '$1');
    limpio = limpio.replace(/\\times/g, '×');
    limpio = limpio.replace(/\\cdot/g, '·');
    limpio = limpio.replace(/\\approx/g, '≈');
    limpio = limpio.replace(/\\leq/g, '≤');
    limpio = limpio.replace(/\\geq/g, '≥');
    limpio = limpio.replace(/\\neq/g, '≠');
    limpio = limpio.replace(/\\pm/g, '±');
    limpio = limpio.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
    limpio = limpio.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
    limpio = limpio.replace(/\\left/g, '');
    limpio = limpio.replace(/\\right/g, '');
    limpio = limpio.replace(/\\,/g, ' ');
    limpio = limpio.replace(/\\\\/g, '');

    // ── 4. Signos $ huérfanos de LaTeX (no precios) ──
    //    "$50W$" → "50W" pero "$850 COP" queda intacto
    limpio = limpio.replace(/\$(\d+[A-Za-z]+)\$/g, '$1');

    // ── 5. Limpiar espacios múltiples ──
    limpio = limpio.replace(/  +/g, ' ');

    return limpio.trim();
}

/**
 * Limpia el contenido DENTRO de un bloque LaTeX.
 */
function limpiarContenidoLatex(contenido) {
    let c = contenido;
    c = c.replace(/\\text\{([^}]*)\}/g, '$1');
    c = c.replace(/\\mathbf\{([^}]*)\}/g, '**$1**');
    c = c.replace(/\\textbf\{([^}]*)\}/g, '**$1**');
    c = c.replace(/\\mathrm\{([^}]*)\}/g, '$1');
    c = c.replace(/\\times/g, '×');
    c = c.replace(/\\cdot/g, '·');
    c = c.replace(/\\approx/g, '≈');
    c = c.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
    c = c.replace(/\\left|\\right/g, '');
    c = c.replace(/\\,/g, ' ');
    c = c.replace(/[{}]/g, '');
    c = c.replace(/\^(\w)/g, '^$1');
    c = c.replace(/_(\w)/g, '$1');
    return c.trim();
}

module.exports = { limpiarFormato };

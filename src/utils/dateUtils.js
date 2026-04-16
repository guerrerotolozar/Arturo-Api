/**
 * Utilidades de fecha/hora para Arturo.
 * Usa la zona horaria REAL del sistema operativo, sin hardcodear.
 */

/**
 * Obtiene la fecha y hora actual del servidor en formato legible.
 * @returns {string} - Fecha/hora formateada con zona horaria del servidor
 */
function obtenerFechaHoraLocal() {
    const ahora = new Date();
    return ahora.toLocaleString('es-CO', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

/**
 * Obtiene un timestamp simple para entradas del vault.
 * @returns {string} - Fecha/hora en formato corto colombiano
 */
function obtenerTimestamp() {
    return new Date().toLocaleString('es-CO');
}

module.exports = {
    obtenerFechaHoraLocal,
    obtenerTimestamp
};

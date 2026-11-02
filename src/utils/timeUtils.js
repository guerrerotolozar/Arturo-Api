/**
 * src/utils/timeUtils.js
 * 
 * Funciones de utilidad para horarios y tiempo.
 */
const { ENABLE_TRADING_SCHEDULE } = require('../config/env');

let manualPause = false;

function setManualPause(val) {
    manualPause = val;
    console.log(`[SYSTEM] Estado de Pausa Manual Trading cambiado a: ${val}`);
}

function isManualPaused() {
    return manualPause;
}

function isTradingHours() {
    if (!ENABLE_TRADING_SCHEDULE) return false;
    if (manualPause) return false;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Bogota',
        hour12: false,
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric'
    });
    
    const parts = formatter.formatToParts(now);
    let weekday = '';
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
        if (p.type === 'weekday') weekday = p.value;
        if (p.type === 'hour') hour = parseInt(p.value, 10);
        if (p.type === 'minute') minute = parseInt(p.value, 10);
    }
    
    const timeInMinutes = hour * 60 + minute;
    
    const isMonToThu = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'].includes(weekday);
    const isFriday = weekday === 'Friday';
    
    if (isMonToThu) {
        if (timeInMinutes >= 180 && timeInMinutes < 960) return true; // 03:00 a 16:00
    } else if (isFriday) {
        if (timeInMinutes >= 180 && timeInMinutes < 975) return true; // 03:00 a 16:15
    }
    
    return false;
}

module.exports = {
    isTradingHours,
    setManualPause,
    isManualPaused
};

/**
 * bancolombiaParser.js — Parser de notificaciones de compra de Bancolombia.
 * 
 * Soporta:
 *   - Tarjeta de Crédito (T.Cred) con formato COP
 *   - Tarjeta de Débito (T.Deb) con formato $
 *   - Compras Online (pasarela) y Físicas (datáfono)
 */

class BancolombiaGastosParser {
    constructor() {
        this.bankName = 'Bancolombia';
    }

    /**
     * Determina si un correo es una notificación de compra.
     * Busca "Bancolombia" y "Compraste" en cualquier parte del email.
     */
    canParse(from, subject, textBody = '') {
        const haystack = `${from} ${subject} ${textBody}`.toLowerCase();
        return haystack.includes('bancolombia') && haystack.includes('compraste');
    }

    /**
     * Extrae los datos de la compra del texto del correo.
     * Retorna null si no se puede parsear.
     */
    parse(text) {
        if (!text) return null;

        const cleaned = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

        // ─── Regex principal ───
        // Formato Débito:  "Compraste $1,00 en COMERCIO con tu T.Deb *5045, el DD/MM/YYYY a las HH:MM"
        // Formato Crédito: "Compraste COP55.900,00 en COMERCIO, el HH:MM a las DD/MM/YYYY"
        // Formato Crédito: "Compraste COP16.100,00 en COMERCIO con tu T.Cred *3386, el DD/MM/YYYY a las HH:MM"
        
        const regex = /Compraste\s+(?:COP|\$)\s*([\d.,]+)\s+en\s+(.+?)(?:\s+con\s+tu\s+)?(?:,\s*el\s+|\s+con\s+tu\s+T\.(?:Cred|Deb)\s+\*(\d{4}),\s*el\s+)(\d{2}[/:]?\d{2}(?:[/:]\d{4})?)(?:\s+a\s+las?\s+)(\d{2}[/:]?\d{2}(?:[/:]\d{4})?)/i;

        const match = cleaned.match(regex);
        if (!match) {
            return this._fallbackParse(cleaned);
        }

        const { fecha, hora } = this._resolverFechaHora(match[4], match[5]);
        const tipo = this._detectarTipoTarjeta(cleaned);

        return {
            monto: this._parseMonto(match[1]),
            comercio: this._limpiarComercio(match[2]),
            tarjeta: match[3] || this._extractTarjeta(cleaned),
            tipo,
            fecha,
            hora,
        };
    }

    _fallbackParse(text) {
        const montoMatch = text.match(/Compraste\s+(?:COP|\$)\s*([\d.,]+)/i);
        if (!montoMatch) return null;

        const comercioMatch = text.match(/en\s+(.+?)(?:\s+con\s+tu|\s*,\s*el)/i);
        const tarjetaMatch = text.match(/T\.(?:Cred|Deb)\s+\*(\d{4})/i);
        const fechaMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
        const horaMatch = text.match(/(\d{2}:\d{2})/);

        return {
            monto: this._parseMonto(montoMatch[1]),
            comercio: this._limpiarComercio(comercioMatch ? comercioMatch[1] : 'Desconocido'),
            tarjeta: tarjetaMatch ? tarjetaMatch[1] : '????',
            tipo: this._detectarTipoTarjeta(text),
            fecha: fechaMatch ? fechaMatch[1] : new Date().toLocaleDateString('es-CO'),
            hora: horaMatch ? horaMatch[1] : '--:--',
        };
    }

    _parseMonto(raw) {
        let limpio = raw.replace(/\./g, '');
        limpio = limpio.replace(/,\d{2}$/, '');
        limpio = limpio.replace(/,/g, '');
        const num = parseInt(limpio, 10);
        return isNaN(num) ? 0 : num;
    }

    _limpiarComercio(nombre) {
        return nombre.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
    }

    _extractTarjeta(text) {
        const match = text.match(/T\.(?:Cred|Deb)\s+\*(\d{4})/i);
        return match ? match[1] : '????';
    }

    _detectarTipoTarjeta(text) {
        if (/T\.Deb/i.test(text)) return 'Débito';
        if (/T\.Cred/i.test(text)) return 'Crédito';
        return 'Desconocido';
    }

    _resolverFechaHora(bloque1, bloque2) {
        const esFecha = (s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s);
        const esHora = (s) => /^\d{2}:\d{2}$/.test(s);

        if (esFecha(bloque1) && esHora(bloque2)) return { fecha: bloque1, hora: bloque2 };
        if (esHora(bloque1) && esFecha(bloque2)) return { fecha: bloque2, hora: bloque1 };
        if (esFecha(bloque1)) return { fecha: bloque1, hora: bloque2 };
        if (esFecha(bloque2)) return { fecha: bloque2, hora: bloque1 };

        return { fecha: bloque1, hora: bloque2 };
    }
}

module.exports = BancolombiaGastosParser;

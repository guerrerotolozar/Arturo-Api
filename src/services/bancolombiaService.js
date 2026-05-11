/**
 * bancolombiaService.js — Orquestador de gastos Bancolombia.
 * 
 * Escucha al imapAdapter, parsea el texto con bancolombiaParser,
 * y escribe la fila en Registro_Gastos.md vía bancolombiaWriter.
 */

const imapAdapter = require('../adapters/imapAdapter');
const BancolombiaGastosParser = require('../utils/bancolombiaParser');
const { appendGasto } = require('../utils/bancolombiaWriter');
const { VAULT_PATH_BOVEDA } = require('../config/env');
const path = require('path');

class BancolombiaService {
    constructor() {
        this.parser = new BancolombiaGastosParser();
        this.gastosFilePath = path.join(
            VAULT_PATH_BOVEDA,
            'OPERACIONES', 'Finanzas', 'Registro_Gastos', 'Registro_Gastos.md'
        );
    }

    async init() {
        // Registrar el listener ANTES de conectar
        imapAdapter.onMessage(this.handleIncomingEmail.bind(this));

        const connected = await imapAdapter.connect();
        if (!connected) return;
    }

    async handleIncomingEmail({ from, subject, text, messageId }) {
        // Verificar que sea un correo de COMPRA (no solo alerta genérica)
        if (!this.parser.canParse(from, subject, text)) {
            console.log(`[BANCOLOMBIA] ⏭️  UID ${messageId}: alerta genérica, no es compra.`);
            return;
        }

        // Parsear datos de la compra
        const gasto = this.parser.parse(text);

        if (!gasto) {
            console.warn(`[BANCOLOMBIA] ⚠️  UID ${messageId}: contiene 'compraste' pero no se pudo extraer datos.`);
            return;
        }

        // Mostrar en terminal
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`💳 GASTO DETECTADO`);
        console.log(`   🏪 ${gasto.comercio}`);
        console.log(`   💰 $${gasto.monto.toLocaleString('es-CO')}`);
        console.log(`   📅 ${gasto.fecha} a las ${gasto.hora}`);
        console.log(`   💳 Tarjeta *${gasto.tarjeta}`);
        console.log(`${'─'.repeat(50)}`);

        // Escribir en Obsidian
        appendGasto(gasto, this.gastosFilePath);

        console.log(`${'═'.repeat(50)}\n`);

        // Marcar como leído en Gmail
        await imapAdapter.markAsRead(messageId);
    }
}

module.exports = new BancolombiaService();

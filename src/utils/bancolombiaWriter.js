/**
 * bancolombiaWriter.js — Escritor de gastos en tabla Markdown de Obsidian.
 * 
 * Cada gasto se agrega como una fila en Registro_Gastos.md.
 */

const fs = require('fs');
const path = require('path');

const TABLE_HEADER = [
    '| Fecha | Hora | Comercio | Monto | Tarjeta | Tipo |',
    '|-------|------|----------|-------|---------|------|'
].join('\n');

function ensureFileWithHeader(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
        const header = [
            '---',
            'tipo: log_datos',
            'sistema_origen: "[[Automatizacion de Finanzas personales]]"',
            'estado: automatizado_imap',
            '---',
            '# 💳 Registro de Gastos — Bancolombia',
            '',
            '> Archivo generado automáticamente por Arturo V8.',
            '',
            TABLE_HEADER
        ].join('\n');
        fs.writeFileSync(filePath, header + '\n', 'utf-8');
        console.log(`[WRITER] 📄 Archivo creado: ${filePath}`);
    }
}

function formatMonto(monto) {
    return `$${monto.toLocaleString('es-CO')}`;
}

function appendGasto(gasto, filePath) {
    ensureFileWithHeader(filePath);

    const fila = `| ${gasto.fecha} | ${gasto.hora} | ${gasto.comercio} | ${formatMonto(gasto.monto)} | *${gasto.tarjeta} | ${gasto.tipo || '-'} |`;

    const contenido = fs.readFileSync(filePath, 'utf-8');
    const nuevoContenido = contenido.trimEnd() + '\n' + fila + '\n';
    fs.writeFileSync(filePath, nuevoContenido, 'utf-8');

    console.log(`   ✅ Gasto registrado: ${gasto.comercio} → ${formatMonto(gasto.monto)} (${gasto.tipo})`);
    return fila;
}

module.exports = { appendGasto, ensureFileWithHeader };

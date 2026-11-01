const { ejecutarPython } = require('../services/pythonSandboxService');

function ejecutarFormula(formula) {
    const OPERADORES_PERMITIDOS = /^[\d\s\+\-\*\/\(\)\.\^%]+$/;
    const limpia = formula.replace(/x/gi, '*').replace(/\^/g, '**').replace(/,/g, '.').trim();
    if (!OPERADORES_PERMITIDOS.test(limpia.replace(/\*\*/g, ''))) {
        throw new Error(`Fórmula contiene caracteres no permitidos: "${formula}"`);
    }
    const resultado = new Function('return ' + limpia)();
    if (typeof resultado !== 'number' || isNaN(resultado)) {
        throw new Error('La fórmula no produjo un número válido');
    }
    return resultado;
}

// ══════════════════════════════════════════════════════════════════
// PLANTILLAS FINANCIERAS DETERMINÍSTICAS
// ══════════════════════════════════════════════════════════════════

function generarPlantillaAmortizacion({ monto, tasa, meses }) {
    const m = parseFloat(monto);
    const t = parseFloat(tasa);
    const n = parseInt(meses);
    if (isNaN(m) || isNaN(t) || isNaN(n)) throw new Error('Parámetros inválidos para amortización');

    return `
monto = ${m}
tasa = ${t}
meses = ${n}

cuota = (monto * tasa) / (1 - (1 + tasa) ** (-meses))
saldo = monto

print(f"Monto: $${m} USD | Tasa mensual: ${tasa*100}% | Plazo: ${meses} meses")
print(f"Cuota fija mensual: $${'{cuota:.2f}'} USD")
print()
print(f"{'Mes':>4} | {'Cuota':>10} | {'Interés':>10} | {'Capital':>10} | {'Saldo':>12}")
print("-" * 55)

total_intereses = 0
for mes in range(1, meses + 1):
    interes = saldo * tasa
    capital = cuota - interes
    saldo = saldo - capital
    total_intereses += interes
    print(f"{mes:>4} | {cuota:>10.2f} | {interes:>10.2f} | {capital:>10.2f} | {max(saldo,0):>12.2f}")

print("-" * 55)
print(f"Total pagado: $${'{cuota * meses:.2f}'} USD")
print(f"Total intereses: $${'{total_intereses:.2f}'} USD")
`;
}

function generarPlantillaROI({ inversion, valor_final, ganancia }) {
    const inv = parseFloat(inversion);
    const vf = valor_final ? parseFloat(valor_final) : null;
    const gan = ganancia ? parseFloat(ganancia) : null;
    if (isNaN(inv)) throw new Error('Falta parámetro "inversion" para ROI');

    const valorFinal = vf || (gan ? inv + parseFloat(gan) : null);
    if (!valorFinal) throw new Error('Falta "valor_final" o "ganancia" para ROI');

    return `
inversion = ${inv}
valor_final = ${valorFinal}
roi = ((valor_final - inversion) / inversion) * 100
ganancia_neta = valor_final - inversion

print(f"Inversión inicial: $${'{inversion:.2f}'} USD")
print(f"Valor final: $${'{valor_final:.2f}'} USD")
print(f"Ganancia neta: $${'{ganancia_neta:.2f}'} USD")
print(f"ROI: ${'{roi:.2f}'}%")
if roi > 0:
    print("Resultado: GANANCIA")
elif roi < 0:
    print("Resultado: PÉRDIDA")
else:
    print("Resultado: NEUTRO (ni ganancia ni pérdida)")
`;
}

const PLANTILLAS = new Map([
    ['amortizacion', generarPlantillaAmortizacion],
    ['roi', generarPlantillaROI],
]);

const TIPOS_FORMULA = ['formula', 'calculo', 'operacion', 'matematica'];

/**
 * Ejecuta el cálculo solicitado delegando a la plantilla correcta o evaluando fórmulas.
 * @param {Object} params - Parámetros del LLM.
 * @returns {Promise<Object>} Resumen y datos del cálculo.
 */
async function realizarCalculo(params) {
    const tipo = (params.tipo || '').toLowerCase().trim();
    console.log(`[CALCULAR_USE_CASE] Tipo: "${tipo}"`);

    if (TIPOS_FORMULA.includes(tipo) || params.formula) {
        const formula = params.formula || params.expresion;
        if (!formula) throw new Error('Falta el campo "formula"');

        const resultado = ejecutarFormula(formula);
        return {
            resumen: `Resultado de "${formula}" = ${resultado}`,
            datos: { tipo: 'formula', formula, resultado }
        };
    }

    const generador = PLANTILLAS.get(tipo);
    if (generador) {
        const codigoPython = generador(params);
        console.log(`[CALCULAR_USE_CASE] Ejecutando Python para "${tipo}"`);
        const salida = await ejecutarPython(codigoPython);
        return {
            resumen: `Resultado del cálculo (${tipo}):\n${salida}`,
            datos: { tipo, stdout: salida }
        };
    }

    return {
        resumen: `No tengo una plantilla para el cálculo tipo "${tipo}". Para cálculos complejos o personalizados, usa el endpoint /IA/consultar que tiene acceso al modelo DEEP.`,
        datos: { tipo, error: 'sin_plantilla' }
    };
}

const TIPOS_DISPONIBLES = [...PLANTILLAS.keys(), 'formula'].join(', ');

module.exports = { realizarCalculo, TIPOS_DISPONIBLES };

/**
 * src/tools/calcularTool.js — Calculadora Determinística de Arturo.
 *
 * ARQUITECTURA "DISPATCHER + ESPECIALISTAS":
 * El modelo FAST (3B) ya NO escribe código. Solo extrae parámetros numéricos
 * del usuario y elige un "tipo" de cálculo. Este archivo contiene plantillas
 * Python pre-escritas por humanos que se ejecutan en sandbox con 0% error.
 *
 * Si el tipo solicitado no tiene plantilla, se devuelve un fallo limpio
 * sugiriendo usar el endpoint /IA/consultar (DEEP).
 *
 * Para agregar una plantilla nueva:
 *   1. Crear función generarPlantillaXxx(params) que retorne string Python
 *   2. Registrarla en el Map PLANTILLAS
 *   3. Listo. Zero cambios en otros archivos.
 */

const vm = require('vm');
const { spawn } = require('child_process');
const { writeFileSync, unlinkSync, existsSync } = require('fs');
const path = require('path');
const os = require('os');

const TIMEOUT_MS = 10_000;

// ══════════════════════════════════════════════════════════════════
// SANDBOX REUTILIZABLE
// ══════════════════════════════════════════════════════════════════

function ejecutarPython(codigo) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(os.tmpdir(), `arturo_calc_${Date.now()}.py`);
        writeFileSync(tmpFile, codigo);

        const stdout = [], stderr = [];
        const proc = spawn('python3', [tmpFile], {
            timeout: TIMEOUT_MS,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
        });

        proc.stdout.on('data', d => stdout.push(d.toString()));
        proc.stderr.on('data', d => stderr.push(d.toString()));

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`No se pudo invocar Python. Asegurate de que 'python3' este instalado. Detalle: ${err.message}`));
        });

        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('Python timeout — ejecución excedió 10s'));
        }, TIMEOUT_MS);

        proc.on('close', code => {
            clearTimeout(timer);
            try { if (existsSync(tmpFile)) unlinkSync(tmpFile); }
            catch (e) { console.warn(`No se pudo borrar temporal:`, e.message); }

            if (code !== 0) reject(new Error(`Python exit ${code}: ${stderr.join('')}`));
            else resolve(stdout.join(''));
        });
    });
}

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

/**
 * Tabla de amortización completa, mes a mes.
 * Fórmula: Cuota = (Monto * i) / (1 - (1+i)^(-n))
 */
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

print(f"Monto: ${m} USD | Tasa mensual: {tasa*100}% | Plazo: {meses} meses")
print(f"Cuota fija mensual: ${'{cuota:.2f}'} USD")
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
print(f"Total pagado: ${'{cuota * meses:.2f}'} USD")
print(f"Total intereses: ${'{total_intereses:.2f}'} USD")
`;
}

/**
 * ROI — Retorno sobre inversión.
 * Fórmula: ROI = ((valor_final - inversion) / inversion) * 100
 */
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

print(f"Inversión inicial: ${'{inversion:.2f}'} USD")
print(f"Valor final: ${'{valor_final:.2f}'} USD")
print(f"Ganancia neta: ${'{ganancia_neta:.2f}'} USD")
print(f"ROI: ${'{roi:.2f}'}%")
if roi > 0:
    print("Resultado: GANANCIA")
elif roi < 0:
    print("Resultado: PÉRDIDA")
else:
    print("Resultado: NEUTRO (ni ganancia ni pérdida)")
`;
}

// ══════════════════════════════════════════════════════════════════
// REGISTRY DE PLANTILLAS (OCP: agregar aquí = listo)
// ══════════════════════════════════════════════════════════════════

const PLANTILLAS = new Map([
    ['amortizacion', generarPlantillaAmortizacion],
    ['roi', generarPlantillaROI],
]);

// Tipos que se reconocen como "fórmula aritmética libre"
const TIPOS_FORMULA = ['formula', 'calculo', 'operacion', 'matematica'];

// ══════════════════════════════════════════════════════════════════
// TOOL EXPORT (Contrato del Tool Registry)
// ══════════════════════════════════════════════════════════════════

const TIPOS_DISPONIBLES = [...PLANTILLAS.keys(), 'formula'].join(', ');

module.exports = {
    nombre: 'calcular',
    descripcion: `Ejecuta calculos matematicos de forma DETERMINISTICA. `
        + `NO escribas codigo, solo extrae los numeros del usuario. `
        + `Parametros: "tipo" (${TIPOS_DISPONIBLES}) + valores numericos segun el tipo. `
        + `Para amortizacion: tipo, monto, tasa (decimal mensual, ej 0.05), meses. `
        + `Para roi: tipo, inversion, valor_final o ganancia. `
        + `Para formula: tipo, formula (expresion aritmetica, ej "3500000 * 0.19").`,

    async ejecutar(params) {
        const tipo = (params.tipo || '').toLowerCase().trim();
        console.log(`[CALCULAR] Tipo: "${tipo}" | Params:`, JSON.stringify(params));

        // 1. ¿Es fórmula aritmética libre?
        if (TIPOS_FORMULA.includes(tipo) || params.formula) {
            const formula = params.formula || params.expresion;
            if (!formula) throw new Error('calcular: falta el campo "formula"');

            const resultado = ejecutarFormula(formula);
            console.log(`[CALCULAR] ${formula} = ${resultado}`);
            return {
                resumen: `Resultado de "${formula}" = ${resultado}`,
                datos: { tipo: 'formula', formula, resultado }
            };
        }

        // 2. ¿Hay plantilla determinística?
        const generador = PLANTILLAS.get(tipo);
        if (generador) {
            const codigoPython = generador(params);
            console.log(`[CALCULAR] Ejecutando plantilla "${tipo}" en Python sandbox`);
            const salida = await ejecutarPython(codigoPython);
            return {
                resumen: `Resultado del cálculo (${tipo}):\n${salida}`,
                datos: { tipo, stdout: salida }
            };
        }

        // 3. Tipo desconocido → fallo limpio
        console.warn(`[CALCULAR] Tipo "${tipo}" no tiene plantilla disponible.`);
        return {
            resumen: `No tengo una plantilla para el cálculo tipo "${tipo}". `
                + `Para cálculos complejos o personalizados, usa el endpoint /IA/consultar `
                + `que tiene acceso al modelo DEEP con mayor capacidad de razonamiento.`,
            datos: { tipo, error: 'sin_plantilla' }
        };
    }
};

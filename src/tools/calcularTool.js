/**
 * src/tools/calcularTool.js — Calculadora Determinística de Arturo.
 * 
 * Refactorizado a Clean Architecture: La herramienta actúa únicamente como un
 * enrutador, delegando la lógica pesada al caso de uso correspondiente.
 */

const { realizarCalculo, TIPOS_DISPONIBLES } = require('../use-cases/calculadoraDeterministicaUseCase');

module.exports = {
    nombre: 'calcular',
    descripcion: `Ejecuta calculos matematicos de forma DETERMINISTICA. `
        + `NO escribas codigo, solo extrae los numeros del usuario. `
        + `Parametros: "tipo" (${TIPOS_DISPONIBLES}) + valores numericos segun el tipo. `
        + `Para amortizacion: tipo, monto, tasa (decimal mensual, ej 0.05), meses. `
        + `Para roi: tipo, inversion, valor_final o ganancia. `
        + `Para formula: tipo, formula (expresion aritmetica, ej "3500000 * 0.19").`,

    async ejecutar(params) {
        try {
            return await realizarCalculo(params);
        } catch (error) {
            console.error(`[CALCULAR_TOOL] Error: ${error.message}`);
            return {
                resumen: `Error al calcular: ${error.message}`,
                datos: { error: error.message }
            };
        }
    }
};

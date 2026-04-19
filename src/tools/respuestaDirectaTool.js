/**
 * respuestaDirectaTool.js
 * 
 * Esta es una "herramienta placebo". 
 * Los modelos pequeños (como Qwen 1.5b) sufren de "Tool Bias": si se les da una lista de herramientas, 
 * sienten la obligación matemática de usar alguna (como code_interpreter) aunque sea una simple charla.
 * 
 * Al existir "respuesta_directa", el modelo pequeño tiene una salida segura. 
 * El agenteRapidoUseCase la detecta y salta directo a la charla con el LLM sin ejecutar nada aquí.
 */

module.exports = {
    nombre: 'respuesta_directa',
    descripcion: 'Para preguntas generales, opiniones, saludos, recomendaciones o charla casual donde NO se necesite calcular, buscar ni ejecutar codigo.',
    
    async ejecutar() {
        // En teoria nunca se deberia invocar porque el agenteRapidoUseCase intercepta este nombre,
        // pero por contrato de las tools, devolvemos un resumen vacío.
        return { resumen: "Respuesta directa seleccionada por la IA.", datos: null };
    }
};

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { ChatOllama } = require("@langchain/ollama");
const { OLLAMA_MODEL, OLLAMA_URL, VAULT_PATH_BOVEDA } = require('../config/env');
const { buscarSemanticamente, estaDisponible, inicializar } = require('../repositories/vectorRepository');

// Carpetas que representan proyectos activos (para detección de oportunidades)
const CARPETAS_PROYECTOS_ACTIVOS = ['BotTrading', 'BotTrading_Liquidez'];

function ejecutarCuraduria() {
    const { enqueue, hasPendingTaskOfType } = require('./gpuQueueService');
    if (!hasPendingTaskOfType('vigilante_curation')) {
        enqueue('vigilante_curation', 4, {});
        console.log('[VIGILANTE] Ronda de curaduría enviada a la cola de GPU (Prioridad 4).');
    }
}

async function ejecutarCuraduriaEncolada() {
    console.log(`\n[VIGILANTE] Iniciando ronda de curaduría de conocimiento...`);
    const mediaDir = path.join(VAULT_PATH_BOVEDA, 'Media');

    let folders;
    try {
        folders = fs.readdirSync(mediaDir, { withFileTypes: true });
    } catch(e) {
        console.warn(`[VIGILANTE] Error leyendo Media:`, e.message);
        return;
    }

    let huerfanos = [];

    for (const d of folders) {
        if (!d.isDirectory() || d.name === '_Huerfanos') continue;
        const fPath = path.join(mediaDir, d.name);
        const mdFile = fs.readdirSync(fPath).find(f => f.endsWith('.md'));
        if (mdFile) {
            const mdPath = path.join(fPath, mdFile);
            const content = fs.readFileSync(mdPath, 'utf8');
            
            // Verificamos si no tiene el bloque de Conexiones Cerebrales
            if (!content.includes('## 🧠 Conexiones Cerebrales')) {
                huerfanos.push({ mdPath, mdFile, content, timestampName: d.name });
            }
        }
    }

    if (huerfanos.length === 0) {
        console.log(`[VIGILANTE] Todo despejado. No hay conocimiento huérfano en la bandeja de entrada.`);
        return;
    }

    console.log(`[VIGILANTE] Encontrados ${huerfanos.length} archivos huérfanos. Curando 1 para no saturar la GPU...`);
    
    // Procesamos solo el primero para hacer rondas progresivas
    const objetivo = huerfanos[0];
    
    console.log(`[VIGILANTE] 📖 Analizando archivo: ${objetivo.mdFile}`);

    const prompt = `Actúa como el "Vigilante", un curador experto de conocimiento para un "Segundo Cerebro" (Zettelkasten) en Obsidian.
He encontrado esta nota multimedia aislada en la bandeja de entrada. Contiene información valiosa pero no está conectada a la base de conocimiento principal.

Tu tarea es leer el contenido de esta nota aislada y generar una "Nota Conceptual" universal, atemporal y académica.
La nueva nota debe extraer los conceptos teóricos y prácticos fundamentales. NO hagas referencia a "el autor del video dice" o "en el video se muestra". Debe redactarse como una wiki de conocimiento puro y aplicable.

ESTRUCTURA DE CARPETAS ACTUAL:
Tu conocimiento debe guardarse dentro de la carpeta: "OPERACIONES/Laboratorio Tech/Conceptos".
Allí existen subcarpetas como:
- Desarrollo
- Herramientas (subcarpetas: APIs y Testing, Bases de Datos, Frameworks y Librerias, Infraestructura, Lenguajes, Multimedia)
- IA
- Trading

Elige la ruta más adecuada para este nuevo concepto. Si no encaja perfectamente en ninguna de las existentes, puedes inventar una nueva subcarpeta bajo "Conceptos" o bajo "Herramientas".

=== CONTENIDO DE LA NOTA AISLADA ===
${objetivo.content.substring(0, 8000)}
===================================`;

    try {
        const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
        const llm = new ChatOllama({ baseUrl, model: OLLAMA_MODEL, temperature: 0.2 });
        
        const schemaCuraduria = z.object({
            ruta_relativa: z.string().describe("Ruta del vault donde se guardará la nota. Ej: OPERACIONES/Laboratorio Tech/Conceptos/IA"),
            titulo_nota: z.string().describe("Un título corto, descriptivo y universal (Ej: Optimizacion Bayesiana en Python)"),
            contenido_markdown: z.string().describe("Contenido teórico detallado formateado en Markdown. Incluye el # Título principal.")
        });
        
        const llmConEstructura = llm.withStructuredOutput(schemaCuraduria, { name: "nota_conceptual" });
        
        console.log(`[VIGILANTE] 🧠 Sintetizando concepto universal con el modelo de lenguaje (Structured Output)...`);
        
        let curado = await llmConEstructura.invoke(prompt);
        
        const tituloBruto = curado.titulo_nota || "Concepto_Curado_Automatico";
        const contenidoBruto = curado.contenido_markdown || "Contenido no generado.";
        let rutaRelativa = curado.ruta_relativa || 'OPERACIONES/Laboratorio Tech/Conceptos/Otros';
        
        const safeTitle = String(tituloBruto).replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_');
        
        // ================================================================
        // ANTI-DUPLICADOS: Consultar LanceDB antes de crear
        // ================================================================
        let fusionado = false;
        try {
            const disponible = await estaDisponible();
            if (disponible) {
                await inicializar();
                const similares = await buscarSemanticamente(tituloBruto, 3, []);
                
                // Filtrar solo notas de conocimiento (no de Media)
                const candidatos = similares.filter(r => 
                    r.metadata && r.metadata.ruta && 
                    !r.metadata.ruta.includes('/Media/') && !r.metadata.ruta.includes('\\Media\\')
                );
                
                if (candidatos.length > 0 && candidatos[0].distancia < 0.15) {
                    // Concepto casi idéntico ya existe — fusionar en vez de duplicar
                    const rutaExistente = path.join(VAULT_PATH_BOVEDA, candidatos[0].metadata.ruta);
                    
                    if (fs.existsSync(rutaExistente)) {
                        const nombreExistente = path.basename(rutaExistente, '.md');
                        console.log(`[VIGILANTE] 🔄 Concepto similar detectado (distancia: ${candidatos[0].distancia.toFixed(3)}): "${nombreExistente}"`);
                        console.log(`[VIGILANTE] 🔄 Fusionando conocimiento nuevo en la nota existente en vez de crear duplicado.`);
                        
                        const contenidoExistente = fs.readFileSync(rutaExistente, 'utf8');
                        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                        const bloqueFusion = `\n\n---\n\n## 📎 Ampliación (${timestamp})\n*Conocimiento complementario fusionado desde: [[Media/${objetivo.timestampName}/${objetivo.mdFile}]]*\n\n${contenidoBruto}\n`;
                        
                        fs.writeFileSync(rutaExistente, contenidoExistente + bloqueFusion, 'utf8');
                        console.log(`[VIGILANTE] ✔️  Conocimiento fusionado en: ${nombreExistente}.md`);
                        
                        // Inyectar enlace en el huérfano apuntando a la nota existente
                        _inyectarEnlaceEnHuerfano(objetivo, nombreExistente);
                        fusionado = true;
                    }
                }
            }
        } catch (errVector) {
            console.warn(`[VIGILANTE] ⚠️  Error en anti-duplicados (continuando con creación normal): ${errVector.message}`);
        }
        
        if (fusionado) {
            console.log(`[VIGILANTE] Curaduría completada (fusión). Quedan ${huerfanos.length - 1} en cola.`);
            return;
        }
        
        // ================================================================
        // CREACIÓN DE NOTA NUEVA (flujo normal)
        // ================================================================
        const targetDir = path.join(VAULT_PATH_BOVEDA, rutaRelativa);
        
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log(`[VIGILANTE] Nueva subcarpeta creada: ${rutaRelativa}`);
        }
        
        const newNotePath = path.join(targetDir, `${safeTitle}.md`);
        
        // ================================================================
        // DETECCIÓN DE OPORTUNIDADES EN PROYECTOS ACTIVOS
        // ================================================================
        let seccionOportunidades = '';
        try {
            const disponible = await estaDisponible();
            if (disponible) {
                const conexiones = await buscarSemanticamente(tituloBruto, 10, []);
                
                // Buscar si alguno de los resultados pertenece a un proyecto activo
                const hits = conexiones.filter(r => 
                    r.metadata && r.metadata.ruta &&
                    CARPETAS_PROYECTOS_ACTIVOS.some(carpeta => r.metadata.ruta.includes(carpeta)) &&
                    r.distancia < 0.35
                );
                
                if (hits.length > 0) {
                    const proyectosDetectados = new Set();
                    const notasRelacionadas = [];
                    
                    for (const hit of hits) {
                        const carpetaProyecto = CARPETAS_PROYECTOS_ACTIVOS.find(c => hit.metadata.ruta.includes(c));
                        if (carpetaProyecto) proyectosDetectados.add(carpetaProyecto);
                        const nombreNota = path.basename(hit.metadata.ruta, '.md');
                        if (!notasRelacionadas.includes(nombreNota)) {
                            notasRelacionadas.push(nombreNota);
                        }
                    }
                    
                    console.log(`[VIGILANTE] 💡 Oportunidad detectada: Conexión con proyecto(s) [${[...proyectosDetectados].join(', ')}]`);
                    
                    seccionOportunidades = `\n\n---\n\n## 💡 Oportunidades de Aplicación\n`;
                    seccionOportunidades += `Este concepto tiene conexión directa con los siguientes proyectos activos:\n`;
                    for (const proyecto of proyectosDetectados) {
                        seccionOportunidades += `- **${proyecto}**\n`;
                    }
                    seccionOportunidades += `\nNotas relacionadas:\n`;
                    for (const nota of notasRelacionadas.slice(0, 4)) {
                        seccionOportunidades += `- [[${nota}]]\n`;
                    }
                    seccionOportunidades += `\n> *Oportunidad detectada automáticamente por El Vigilante.*\n`;
                }
            }
        } catch (errOpp) {
            console.warn(`[VIGILANTE] ⚠️  Error buscando oportunidades: ${errOpp.message}`);
        }
        
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const finalNoteContent = `---
tipo: concepto_curado
creado: ${timestamp}
origen: "[[Media/${objetivo.timestampName}/${objetivo.mdFile}]]"
---

${contenidoBruto}
${seccionOportunidades}
---
*Concepto extraído y curado automáticamente por El Vigilante.*
`;

        // Crear la nueva nota conceptual
        fs.writeFileSync(newNotePath, finalNoteContent, 'utf8');
        console.log(`[VIGILANTE] ✔️  Nueva Nota Conceptual creada en ${rutaRelativa}: ${safeTitle}.md`);

        // Inyectar enlace en el huérfano original
        _inyectarEnlaceEnHuerfano(objetivo, safeTitle);
        
        console.log(`[VIGILANTE] Curaduría completada con éxito. Quedan ${huerfanos.length - 1} en cola.`);
        
    } catch (e) {
        console.error(`[VIGILANTE] ❌ Error en la curaduría:`, e.message);
    }
}

/**
 * Inyecta el bloque de Conexiones Cerebrales en el archivo huérfano original.
 */
function _inyectarEnlaceEnHuerfano(objetivo, tituloNota) {
    try {
        const block = `\n---\n\n## 🧠 Conexiones Cerebrales\nNotas relacionadas en tu bóveda de conocimiento:\n- [[${tituloNota}]]\n`;
        let oldContent = objetivo.content;
        
        if (oldContent.includes('*Nota generada automáticamente')) {
            oldContent = oldContent.replace(/---\n\*Nota generada automáticamente/, `${block}\n---\n*Nota generada automáticamente`);
        } else {
            oldContent += block;
        }
        
        fs.writeFileSync(objetivo.mdPath, oldContent, 'utf8');
        console.log(`[VIGILANTE] 🔗 Enlace inyectado exitosamente en el archivo huérfano original.`);
    } catch (errLink) {
        console.warn(`[VIGILANTE] ⚠️  Error inyectando enlace: ${errLink.message}`);
    }
}
module.exports = {
    ejecutarCuraduria,
    ejecutarCuraduriaEncolada
};

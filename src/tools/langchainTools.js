const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const fs = require('fs');
const path = require('path');
const { buscarEnWeb } = require('../adapters/tavilyAdapter');
const { buscarSemanticamente, estaDisponible } = require('../repositories/vectorRepository');
const { realizarCalculo } = require('../use-cases/calculator');
const { VAULT_PATH_BOVEDA } = require('../config/env');

// 1. Herramienta de Búsqueda Web
const buscar_internet = tool(
    async ({ query }) => {
        try {
            console.log(`[LANGCHAIN TOOL] buscar_internet: "${query}"`);
            const web = await buscarEnWeb(query);
            if (!web || !web.results) return "No se encontraron resultados.";
            return web.answer 
                ? web.answer 
                : web.results.slice(0, 3).map(r => `[${r.title}] ${r.content}`).join('\n\n');
        } catch (error) {
            return `Error buscando en internet: ${error.message}`;
        }
    },
    {
        name: "buscar_internet",
        description: "Ejecuta una búsqueda en internet para obtener información pública, noticias o conceptos técnicos globales.",
        schema: z.object({
            query: z.string().describe("El término o pregunta exacta a buscar en internet")
        })
    }
);

// 2. Herramienta de Consulta a la Bóveda
const consultar_boveda = tool(
    async ({ query }) => {
        try {
            console.log(`[LANGCHAIN TOOL] consultar_boveda: "${query}"`);
            const disponible = await estaDisponible();
            if (!disponible) return "La base de datos vectorial de la bóveda no está disponible.";
            
            const resultados = await buscarSemanticamente(query, 5, []);
            if (resultados.length > 0) {
                return resultados.map(r => `Fuente: ${r.metadata.fuente}\nContenido:\n${r.texto}`).join('\n\n');
            }
            return `No encontré nada en la bóveda sobre: "${query}"`;
        } catch (error) {
            return `Error buscando en la bóveda: ${error.message}`;
        }
    },
    {
        name: "consultar_boveda",
        description: "Realiza una búsqueda semántica en la base de datos vectorial (memoria interna) para recuperar contexto personal, notas previas o información técnica del entorno del usuario.",
        schema: z.object({
            query: z.string().describe("El término a buscar en la memoria")
        })
    }
);

// 3. Herramienta de Guardado Estructurado
const guardar_boveda = tool(
    async (params) => {
        try {
            console.log(`[LANGCHAIN TOOL] guardar_boveda: "${params.titulo}"`);
            
            const safeName = params.titulo.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
            if (!safeName) return "Error: El título contiene caracteres inválidos.";

            const resolvedVault = path.resolve(VAULT_PATH_BOVEDA);
            const destFolder = path.resolve(VAULT_PATH_BOVEDA, params.carpeta_destino || '');
            if (!destFolder.startsWith(resolvedVault + path.sep) && destFolder !== resolvedVault) {
                return 'Error: La carpeta de destino debe estar estrictamente dentro de la Bóveda.';
            }

            if (!fs.existsSync(destFolder)) {
                fs.mkdirSync(destFolder, { recursive: true });
            }

            const filePath = path.join(destFolder, `${safeName}.md`);
            
            const hoy = new Date().toISOString().split('T')[0];
            const tagsStr = params.yaml_tags.map(t => `  - ${t}`).join('\n');
            
            const markdownFinal = `---
tipo: ${params.yaml_tipo}
estado: ${params.yaml_estado}
tags:
${tagsStr}
fecha_creacion: ${hoy}
descripcion: "${params.yaml_descripcion}"
---

# ${params.titulo}

${params.contenido_markdown}
`;

            fs.writeFileSync(filePath, markdownFinal, 'utf8');
            return `Archivo guardado exitosamente en: ${filePath}`;
        } catch (error) {
            return `Error guardando archivo en bóveda: ${error.message}`;
        }
    },
    {
        name: "guardar_boveda",
        description: "Crea y almacena una nota estructurada en formato Markdown en la base de datos interna para persistir conocimiento técnico o hallazgos importantes.",
        schema: z.object({
            carpeta_destino: z.string().describe("Ruta exacta dentro de la Bóveda según estructura.yaml (ej. 'OPERACIONES/Conceptos/IA', 'OPERACIONES/Herramientas/Infraestructura', 'OPERACIONES/_Bandeja')"),
            titulo: z.string().describe("Título del archivo"),
            yaml_tipo: z.string().describe("Categoría principal (ej. 'tecnologia', 'concepto')"),
            yaml_estado: z.string().describe("Estado actual (ej. 'activo', 'borrador')"),
            yaml_tags: z.array(z.string()).describe("Lista de 3 a 5 etiquetas relevantes (sin #)"),
            yaml_descripcion: z.string().describe("Resumen de 1 a 2 líneas"),
            contenido_markdown: z.string().describe("El desarrollo detallado del tema en formato Markdown, incluyendo secciones como: 'descripcion', 'Uso en el ecosistema Arturo', 'Ejemplo de uso' y 'Ver también'.")
        })
    }
);

// 4. Herramienta de Cálculo Financiero
const calcular_finanzas = tool(
    async (params) => {
        try {
            console.log(`[LANGCHAIN TOOL] calcular_finanzas: ${JSON.stringify(params)}`);
            const res = await realizarCalculo(params);
            return res.resumen;
        } catch (error) {
            return `Error de cálculo: ${error.message}`;
        }
    },
    {
        name: "calcular_finanzas",
        description: "Calcula amortizaciones, cuotas de préstamos, ROI o expresiones matemáticas exactas.",
        schema: z.object({
            tipo: z.enum(['amortizacion', 'roi', 'formula']).describe("El tipo de cálculo"),
            monto: z.number().optional().describe("Para amortizacion: Monto del préstamo"),
            tasa: z.number().optional().describe("Para amortizacion: Tasa de interés mensual decimal (ej. 1.992% = 0.01992)"),
            meses: z.number().optional().describe("Para amortizacion: Plazo en meses"),
            inversion: z.number().optional().describe("Para roi: Inversión inicial"),
            valor_final: z.number().optional().describe("Para roi: Valor final"),
            formula: z.string().optional().describe("Para formula: Expresión aritmética simple (ej. '1000 * 0.19')")
        })
    }
);

module.exports = {
    buscar_internet,
    consultar_boveda,
    guardar_boveda,
    calcular_finanzas,
    toolsList: [buscar_internet, consultar_boveda, guardar_boveda, calcular_finanzas]
};

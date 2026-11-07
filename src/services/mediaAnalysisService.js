/**
 * src/services/mediaAnalysisService.js
 *
 * Analiza en segundo plano la metadata de videos descargados (descripción y comentarios).
 * Sugiere títulos descriptivos, extrae puntos clave, valida afirmaciones en la web
 * mediante Tavily y genera notas en Obsidian (Boveda/Inbox_Media).
 */

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { ChatOllama } = require("@langchain/ollama");
const { buscarEnWeb } = require('../adapters/tavilyAdapter');
const { procesarVideoDesdeRuta } = require('../adapters/videoAdapter');
const { OLLAMA_MODEL, OLLAMA_URL, VAULT_PATH_BOVEDA } = require('../config/env');
const mediaRepo = require('../repositories/mediaRepository');
const vectorRepo = require('../repositories/vectorRepository');
const mayordomoService = require('./mayordomoService');
const { isTradingHours } = require('../utils/timeUtils');
const { enviarNotificacionLocal } = require('../controllers/notificaciones');

const gpuMonitor = require('./gpuMonitorService');
const gpuQueue = require('./gpuQueueService');

/**
 * Encola el análisis de un video en segundo plano.
 *
 * @param {number} mediaId - ID del registro en SQLite.
 * @param {string} infoJsonPath - Ruta absoluta al archivo .info.json temporal.
 * @param {string} videoFilePath - Ruta absoluta al video en disco.
 */
async function analizarYVerificarMedia(mediaId, infoJsonPath, videoFilePath) {
    // SIEMPRE encolamos. La cola se encargará de gestionar el orden y proteger la VRAM.
    // Si la GPU está libre, la cola lo procesará de inmediato.
    // Si la GPU está ocupada o es horario trader, la cola lo pondrá en espera.
    
    let razonCuarentena = null;
    if (gpuMonitor.isGpuBusy()) razonCuarentena = "GPU ocupada";
    else if (isTradingHours()) razonCuarentena = "Horario de Trading activo";
    
    if (razonCuarentena) {
        console.log(`[MEDIA_ANALYSIS] ⏸️ ${razonCuarentena}. Encolando análisis (Cuarentena) para ID #${mediaId}`);
        if (enviarNotificacionLocal) {
            enviarNotificacionLocal({
                titulo: 'Video en Cuarentena ⏸️',
                mensaje: `Análisis pospuesto por: ${razonCuarentena}`,
                tipo: 'info'
            });
        }
    } else {
        console.log(`[MEDIA_ANALYSIS] 📥 Encolando análisis para ID #${mediaId} (GPU Libre)`);
    }

    gpuQueue.enqueue('media_analysis', 2, { mediaId, infoJsonPath, videoFilePath });
}

async function ejecutarAnalisisEncolado(payload) {
    await _ejecutarAnalisisCore(payload.mediaId, payload.infoJsonPath, payload.videoFilePath);
}

/**
 * Función interna que hace el trabajo pesado real.
 */
async function _ejecutarAnalisisCore(mediaId, infoJsonPath, videoFilePath) {
    console.log(`[MEDIA_ANALYSIS] Iniciando análisis inteligente para ID #${mediaId}...`);

    try {
        const timeStartTotal = Date.now();
        if (!fs.existsSync(infoJsonPath)) {
            console.warn(`[MEDIA_ANALYSIS] No se encontró el archivo info.json en "${infoJsonPath}". Saltando análisis detallado.`);
            return;
        }

        // 1. Leer y parsear el archivo info.json
        const rawInfo = fs.readFileSync(infoJsonPath, 'utf8');
        const info = JSON.parse(rawInfo);

        const originalTitle = info.title || 'Sin título';
        const description = info.description || '';
        const uploader = info.uploader || 'Desconocido';
        const webpageUrl = info.webpage_url || '';

        // Extraer comentarios relevantes (top 30)
        let commentsText = '';
        if (info.comments && Array.isArray(info.comments)) {
            const topComments = info.comments
                .slice(0, 30)
                .map(c => `[Autor: ${c.author || 'Anónimo'} | Likes: ${c.like_count || 0}]: ${c.text}`)
                .join('\n');
            commentsText = `\nComentarios principales:\n${topComments}`;
        }

        // Identificar archivos de subtítulos residuales (.vtt, .srt) para limpieza
        const videoDir = path.dirname(videoFilePath);
        const timestampName = path.basename(videoFilePath, path.extname(videoFilePath));
        let transcripcionText = ''; // Ya no usamos subtítulos estáticos, dependemos de Whisper
        let subtitleFilesEncontrados = [];

        try {
            const archivos = fs.readdirSync(videoDir);
            subtitleFilesEncontrados = archivos.filter(f => f.startsWith(timestampName) && (f.endsWith('.vtt') || f.endsWith('.srt')));
        } catch (errSubs) {
            console.warn('[MEDIA_ANALYSIS] Error buscando subtítulos:', errSubs.message);
        }

        // --- EXTRACCIÓN PROFUNDA (Whisper + Vision) ---
        let deepContextoVisual = '';
        let deepTranscripcion = '';
        let timeDeepExtraction = 0;

        if (videoFilePath && fs.existsSync(videoFilePath)) {
            console.log(`[MEDIA_ANALYSIS] Iniciando Extracción Profunda (Vision + Whisper) para "${originalTitle}"...`);
            const startDeep = Date.now();
            try {
                const resultadoDeep = await procesarVideoDesdeRuta(videoFilePath, (msg) => console.log(`[DEEP_EXTRACT] ${msg}`), 'auto');
                deepContextoVisual = resultadoDeep.contextoVisual;
                deepTranscripcion = resultadoDeep.transcripcion;
            } catch (errDeep) {
                console.warn(`[MEDIA_ANALYSIS] Error en extracción profunda: ${errDeep.message}`);
            }
            timeDeepExtraction = Date.now() - startDeep;
            console.log(`[MEDIA_ANALYSIS] Extracción profunda completada en ${(timeDeepExtraction / 1000).toFixed(1)}s.`);
        }

        console.log(`[MEDIA_ANALYSIS] Enviando metadata de "${originalTitle}" a Ollama para análisis...`);

        let guionEntrelazado = "";
        
        if (Array.isArray(deepContextoVisual) && deepTranscripcion && deepTranscripcion.segments) {
            for (const visual of deepContextoVisual) {
                const audioStart = Math.max(0, visual.start - 3);
                const audioEnd = visual.end + 3;
                
                const segmentTexts = deepTranscripcion.segments
                    .filter(seg => seg.start < audioEnd && seg.end > audioStart)
                    .map(seg => seg.text.trim());
                    
                const audioContext = segmentTexts.length > 0 ? segmentTexts.join(" ") : "(Silencio)";
                
                const startStr = new Date(visual.start * 1000).toISOString().substring(14, 19);
                const endStr = new Date(visual.end * 1000).toISOString().substring(14, 19);
                
                guionEntrelazado += `\n[${startStr} - ${endStr}]\n`;
                guionEntrelazado += `VISUAL: ${visual.texto}\n`;
                guionEntrelazado += `AUDIO: "${audioContext}"\n`;
            }
        } else {
            // Fallback
            if (deepTranscripcion && deepTranscripcion.text) {
                guionEntrelazado += `- Transcripción Whisper: "${deepTranscripcion.text.substring(0, 40000)}"\n`;
            }
            if (typeof deepContextoVisual === 'string') {
                guionEntrelazado += `- Contexto Visual: \n${deepContextoVisual.substring(0, 20000)}\n`;
            }
        }

        const blockMultimodal = guionEntrelazado 
            ? `- Guion Multimodal Entrelazado (Audio y Video sincronizados con margen de 3s):\n${guionEntrelazado}\n` 
            : '';

        const blockTranscripcion = transcripcionText 
            ? `- Diálogo Transcrito (Subtítulos Originales): "${transcripcionText.substring(0, 40000)}"\n` 
            : '';

        const contextoMayordomo = mayordomoService.obtenerContextoParaIA();

        // 2. Prompt estructurado para Ollama
        const prompt = `Analiza la siguiente información de un video descargado (Título original, descripción, contexto visual, transcripción y comentarios). 
Tu rol es ser un documentalista y archivero objetivo. Describe de qué trata el video, qué muestra y qué afirma el autor, manteniendo un tono descriptivo. 
Genera todo el contenido estrictamente en ESPAÑOL.

Categorías históricas del usuario:
${contextoMayordomo}

Información del Video:
- Título Original: "${originalTitle}"
- Uploader: "${uploader}"
- Descripción: "${description.substring(0, 1200)}"
${blockTranscripcion}${blockMultimodal}${commentsText}

INSTRUCCIONES DE SALIDA:
Debes responder ÚNICAMENTE con un objeto JSON válido con la siguiente estructura exacta:
{
  "titulo_mejorado": "Título descriptivo sin clickbait y en español",
  "categoria": "Categoría principal (ej: tecnología, finanzas, hardware)",
  "categorias_secundarias": ["subcategoría 1", "subcategoría 2"],
  "resumen_ejecutivo": "Párrafo detallado resumiendo el contenido del video",
  "tipo_contenido": "Tutorial/Guía",
  "secciones_dinamicas": [
    { "titulo_seccion": "Puntos Clave", "contenido": ["Punto 1", "Punto 2"] }
  ],
  "query_verificacion": "Consulta de búsqueda para validar en la web"
}
Nota: "tipo_contenido" debe ser uno de: "Tutorial/Guía", "Noticias/Debate", "Educativo/Documental", "Entretenimiento/Vlog", "Review/Unboxing", "Otro".
No agregues texto explicativo fuera del JSON.`;

        const startOllama = Date.now();
        const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
        const llm = new ChatOllama({ baseUrl, model: OLLAMA_MODEL, temperature: 0.1, numCtx: 50000 });
        
        const schemaVideoAnalysis = z.object({
            titulo_mejorado: z.string().describe("Un título descriptivo, claro y en español"),
            categoria: z.string().describe("Una sola palabra o categoría principal (ej: finanzas, tecnología, gaming)"),
            categorias_secundarias: z.any().transform(val => {
                if (Array.isArray(val)) return val.map(String);
                if (typeof val === 'string') return val.split(',').map(s => s.trim());
                return [];
            }).describe("Lista de categorías secundarias relacionadas"),
            resumen_ejecutivo: z.string().describe("Un párrafo detallado resumiendo el contenido y la narrativa general del video en español"),
            tipo_contenido: z.enum(["Tutorial/Guía", "Noticias/Debate", "Educativo/Documental", "Entretenimiento/Vlog", "Review/Unboxing", "Otro"]).describe("Identifica la naturaleza general del video"),
            secciones_dinamicas: z.any().transform(val => {
                if (Array.isArray(val)) return val;
                if (typeof val === 'string') return [{ titulo_seccion: 'Puntos Clave', contenido: [val] }];
                if (typeof val === 'object' && val !== null) {
                    return Object.entries(val).map(([k, v]) => ({ titulo_seccion: k, contenido: Array.isArray(v) ? v : [String(v)] }));
                }
                return [];
            }).describe("Crea de 2 a 4 secciones lógicas que estructuren y describan de forma natural la información mostrada en el video."),
            query_verificacion: z.string().describe("Consulta de búsqueda concisa para buscar en la web y validar las afirmaciones. DEBES dar siempre una.")
        });

        // Función defensiva para normalizar claves sin importar cómo responda el modelo
        function normalizarAnalisis(raw, fallbackTitulo) {
            const d = (raw && typeof raw === 'object') ? (raw.analisis_video || raw.analisis || raw.video || raw) : {};
            const tiposValidos = ["Tutorial/Guía", "Noticias/Debate", "Educativo/Documental", "Entretenimiento/Vlog", "Review/Unboxing", "Otro"];
            const tipoDetectado = d.tipo_contenido || d.content_type || d.type || "Educativo/Documental";

            return {
                titulo_mejorado: String(d.titulo_mejorado || d.titulo || d.title || d.improved_title || fallbackTitulo || 'Video').trim(),
                categoria: String(d.categoria || d.category || 'tecnologia').trim().toLowerCase(),
                categorias_secundarias: Array.isArray(d.categorias_secundarias) 
                    ? d.categorias_secundarias 
                    : (Array.isArray(d.secondary_categories) ? d.secondary_categories : []),
                resumen_ejecutivo: String(d.resumen_ejecutivo || d.resumen || d.summary || d.description || 'Sin resumen disponible').trim(),
                tipo_contenido: tiposValidos.includes(tipoDetectado) ? tipoDetectado : "Educativo/Documental",
                secciones_dinamicas: Array.isArray(d.secciones_dinamicas) 
                    ? d.secciones_dinamicas 
                    : (Array.isArray(d.sections) ? d.sections : [{ titulo_seccion: 'Puntos Clave', contenido: [d.resumen_ejecutivo || 'Contenido analizado'] }]),
                query_verificacion: String(d.query_verificacion || d.query || d.search_query || fallbackTitulo || 'tecnologia tutorial').trim()
            };
        }
        
        let analysis;
        try {
            console.log(`[MEDIA_ANALYSIS] 🧠 Analizando lógica e información con Ollama (${OLLAMA_MODEL})...`);
            // Invocar directamente forzando formato JSON nativo de Ollama
            const respuestaRaw = await llm.invoke(prompt, { format: "json" });
            const texto = typeof respuestaRaw === 'string' ? respuestaRaw : (respuestaRaw.content || '');
            
            const matchJson = texto.match(/\{[\s\S]*\}/);
            if (!matchJson) {
                throw new Error(`No se encontró bloque JSON en la respuesta de Ollama. Contenido: ${texto.substring(0, 150)}`);
            }
            const objetoParsed = JSON.parse(matchJson[0]);
            const objetoNormalizado = normalizarAnalisis(objetoParsed, originalTitle);
            analysis = schemaVideoAnalysis.parse(objetoNormalizado);
        } catch (errParse) {
            console.warn(`[MEDIA_ANALYSIS] ⚠️ Error procesando JSON de Ollama: ${errParse.message}. Aplicando fallback de rescate...`);
            analysis = normalizarAnalisis({}, originalTitle);
        }
        
        const timeOllama = Date.now() - startOllama;
        const newTitle = (analysis.titulo_mejorado || originalTitle).trim();
        const mainCategory = (analysis.categoria || 'media').trim().toLowerCase().replace(/\s+/g, '_');
        const secondaryCategories = Array.isArray(analysis.categorias_secundarias) 
            ? analysis.categorias_secundarias.map(c => c.trim().toLowerCase().replace(/\s+/g, '_')) 
            : [];

        const allCategories = [mainCategory, ...secondaryCategories].filter((v, i, a) => a.indexOf(v) === i); // deduplicar

        console.log(`[MEDIA_ANALYSIS] Título mejorado: "${newTitle}"`);
        console.log(`[MEDIA_ANALYSIS] Categorías: [${allCategories.join(', ')}]`);

        // 3. Verificación Web con Tavily (Forzado SIEMPRE)
        let verificacionResult = null;
        let verificacionSintetizada = null;
        let timeTavily = 0;
        if (analysis.query_verificacion && analysis.query_verificacion.trim() !== '') {
            const startTavily = Date.now();
            try {
                console.log(`[MEDIA_ANALYSIS] Realizando búsqueda web avanzada para validar claims: "${analysis.query_verificacion}"`);
                verificacionResult = await buscarEnWeb(analysis.query_verificacion, 'advanced');
                
                if (verificacionResult && verificacionResult.results && verificacionResult.results.length > 0) {
                    console.log(`[MEDIA_ANALYSIS] Sintetizando resultados de la web con Ollama...`);
                    const fragmentosWeb = verificacionResult.results.map(r => `Fuente: ${r.title}\nContenido: ${r.content}\n`).join('\n');
                    const promptSintesis = `Actúa como un analista de datos. Has buscado en la web para verificar el tema: "${newTitle}".\nFragmentos obtenidos:\n${fragmentosWeb}\n\nRedacta un solo párrafo coherente EN ESPAÑOL que resuma esta información de la web. Destaca si la red confirma, desmiente o aporta contexto extra (como buenas prácticas) al tema principal. NO uses formato JSON, responde directamente con el texto en markdown.`;
                    
                    const llmSintesis = new ChatOllama({ baseUrl, model: OLLAMA_MODEL, temperature: 0.3 });
                    const resSintesis = await llmSintesis.invoke(promptSintesis);
                    verificacionSintetizada = resSintesis.content.trim();
                }
            } catch (errSearch) {
                console.warn('[MEDIA_ANALYSIS] Error buscando/sintetizando en web:', errSearch.message);
            }
            timeTavily = Date.now() - startTavily;
        }

        // 4. Crear la nota en Obsidian

        // Nombre de archivo limpio
        const safeFileName = newTitle
            .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '')
            .trim()
            .replace(/\s+/g, '_');

        const noteFilePath = path.join(videoDir, `${safeFileName}.md`);

        // Extraer rutas de media relativas al Vault root (Boveda)
        // videoFilePath es /home/ronald/ARTURO/Cerebro/Boveda/Media/...
        // El link interno de Obsidian debe ser [[Media/subcarpeta/archivo.mp4]]
        const relativeVideoPath = videoFilePath.replace(/\\/g, '/').split('/Boveda/')[1] || '';

        // 3.5 Búsqueda Vectorial para Conexiones Cerebrales (4096d Cosine)
        let conexionesCerebrales = [];
        try {
            console.log(`[MEDIA_ANALYSIS] Buscando conexiones cerebrales en la bóveda...`);
            const searchQuery = `${newTitle}. Categorías: ${(allCategories || []).join(', ')}. ${analysis.resumen_ejecutivo || ''}`.trim();
            const [resultadosProyectos, resultadosVectoriales] = await Promise.all([
                vectorRepo.buscarSemanticamente(searchQuery, 10, [], { soloProyectos: true }),
                vectorRepo.buscarSemanticamente(searchQuery, 20, [], { excluirMedia: true })
            ]);
            
            // Filtrar para no enlazarse a sí mismo ni a otros archivos dentro de Media ni bitácoras crudas
            const resultadosCore = [...resultadosProyectos, ...resultadosVectoriales].filter(r => 
                r.metadata &&
                r.metadata.ruta &&
                !r.metadata.ruta.includes('/Media/') &&
                !r.metadata.ruta.includes('\\Media\\') &&
                !r.metadata.ruta.includes('Bitacora_Ordenes_') &&
                (r.distancia === undefined || r.distancia < 0.48)
            );
            
            // Deduplicar por nombre de nota conservando la menor distancia coseno
            const mejorPorNota = new Map();
            for (const r of resultadosCore) {
                const nombreNota = path.basename(r.metadata.ruta, '.md');
                const prev = mejorPorNota.get(nombreNota);
                if (!prev || r.distancia < prev.distancia) {
                    mejorPorNota.set(nombreNota, {
                        nombreNota,
                        ruta: r.metadata.ruta.replace(/\\/g, '/'),
                        distancia: r.distancia
                    });
                }
            }

            const ordenados = Array.from(mejorPorNota.values()).sort((a, b) => a.distancia - b.distancia);
            const proyectosHits = ordenados.filter(x => x.ruta.includes('OPERACIONES/Proyectos/') || x.ruta.includes('OPERACIONES/Finanzas/')).slice(0, 2);
            const otrosHits = ordenados.filter(x => !proyectosHits.some(p => p.nombreNota === x.nombreNota)).slice(0, 3);

            conexionesCerebrales = [...proyectosHits, ...otrosHits].map(x => x.nombreNota);
            if (conexionesCerebrales.length > 0) {
                console.log(`[MEDIA_ANALYSIS] 🔗 Conexiones detectadas: [${conexionesCerebrales.join(', ')}]`);
            }
        } catch (errVector) {
            console.warn('[MEDIA_ANALYSIS] Error buscando conexiones vectoriales:', errVector.message);
        }

        const timeTotal = Date.now() - timeStartTotal;

        // Construir contenido Markdown
        const noteContent = construirMarkdown({
            titulo: newTitle,
            originalTitle,
            uploader,
            webpageUrl,
            relativeVideoPath,
            categorias: allCategories,
            resumen: analysis.resumen_ejecutivo || analysis.resumen || 'Sin resumen disponible.',
            seccionesDinamicas: analysis.secciones_dinamicas || [],
            verificacionSintetizada,
            verificacionResult,
            conexiones: conexionesCerebrales,
            transcripcion: transcripcionText || (deepTranscripcion && deepTranscripcion.text ? deepTranscripcion.text : ''),
            timers: {
                deep: timeDeepExtraction,
                ollama: timeOllama,
                tavily: timeTavily,
                total: timeTotal
            }
        });

        fs.writeFileSync(noteFilePath, noteContent, 'utf8');
        console.log(`[MEDIA_ANALYSIS] Nota creada en Obsidian: "${noteFilePath}"`);

        // 5. Actualizar registro en SQLite
        mediaRepo.categorizarMedia(mediaId, allCategories, JSON.stringify(analysis));
        
        // Actualizar el título en la base de datos
        mediaRepo.actualizarTituloYInfo(mediaId, newTitle, JSON.stringify(allCategories));

        // 6. Eliminar archivos temporales
        try {
            fs.unlinkSync(infoJsonPath);
            console.log(`[MEDIA_ANALYSIS] Archivo temporal eliminado: ${infoJsonPath}`);
        } catch (errUnlink) {
            console.warn(`[MEDIA_ANALYSIS] No se pudo borrar el archivo info.json:`, errUnlink.message);
        }

        if (subtitleFilesEncontrados && subtitleFilesEncontrados.length > 0) {
            for (const sf of subtitleFilesEncontrados) {
                try {
                    const sfPath = path.join(videoDir, sf);
                    fs.unlinkSync(sfPath);
                    console.log(`[MEDIA_ANALYSIS] Subtítulo temporal eliminado: ${sf}`);
                } catch (errUnlinkSub) {
                    console.warn(`[MEDIA_ANALYSIS] No se pudo borrar el subtítulo temporal:`, errUnlinkSub.message);
                }
            }
        }

        console.log(`[MEDIA_ANALYSIS] ✅ Análisis de ID #${mediaId} completado exitosamente.`);

        // Encadenar El Vigilante automáticamente para curar/ampliar el concepto y evaluar su impacto (1 sola vez)
        try {
            const { ejecutarCuraduria } = require('./vigilanteService');
            ejecutarCuraduria();
        } catch (errVig) {
            console.warn(`[MEDIA_ANALYSIS] No se pudo encolar curaduría automática:`, errVig.message);
        }

    } catch (error) {
        console.error(`[MEDIA_ANALYSIS] ❌ Falló el análisis inteligente del video #${mediaId}:`, error);
    }
}

/**
 * Genera el contenido estructurado de la nota Markdown para Obsidian.
 */
function construirMarkdown({ titulo, originalTitle, uploader, webpageUrl, relativeVideoPath, categorias, resumen, seccionesDinamicas, verificacionSintetizada, verificacionResult, conexiones, transcripcion, timers }) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    let md = `---
tipo: media_resumen
estado: activo
curado_vigilante: false
creado: ${timestamp}
fuente_original: "${uploader}"
url_origen: "${webpageUrl}"
tags:
${categorias.map(c => `  - ${c}`).join('\n')}
---

# ${titulo}

> **Título Original:** ${originalTitle}
> **Canal / Autor:** ${uploader}
> **Enlace:** [Ver en origen](${webpageUrl})

---

## 🎥 Reproducción Local

![[${relativeVideoPath}]]

---

## 📝 Resumen Ejecutivo
${resumen}
`;

    // --- MIDDLEWARE DEFENSIVO PARA SECCIONES DINAMICAS ---
    let seccionesSeguras = [];
    if (Array.isArray(seccionesDinamicas)) {
        seccionesSeguras = seccionesDinamicas;
    } else if (typeof seccionesDinamicas === 'string') {
        seccionesSeguras = [{ titulo_seccion: 'Puntos Clave', contenido: [seccionesDinamicas] }];
    } else if (typeof seccionesDinamicas === 'object' && seccionesDinamicas !== null) {
        // Si el modelo alucinó un diccionario { "Argumentos": ["Punto 1"] }
        seccionesSeguras = Object.entries(seccionesDinamicas).map(([k, v]) => ({
            titulo_seccion: k,
            contenido: Array.isArray(v) ? v : [String(v)]
        }));
    }

    if (seccionesSeguras.length > 0) {
        seccionesSeguras.forEach(sec => {
            if (!sec || typeof sec !== 'object') return;
            const rawTitle = String(sec.titulo_seccion || sec.titulo || sec.title || sec.nombre || '').trim();
            const tituloLimpio = (!rawTitle || /^secci[oó]n$/i.test(rawTitle)) ? 'Puntos Clave y Herramientas' : rawTitle;
            const rawItems = sec.contenido ?? sec.puntos ?? sec.items ?? sec.bullets ?? sec.descripcion ?? [];
            const listaItems = (Array.isArray(rawItems) ? rawItems : [rawItems])
                .map(p => String(p || '').trim())
                .filter(Boolean);

            if (listaItems.length === 0) return;

            md += `\n---\n\n## 💡 ${tituloLimpio}\n`;
            md += listaItems.map(p => `- ${p}`).join('\n') + '\n';
        });
    }

    if (conexiones && conexiones.length > 0) {
        md += `
---

## 🧠 Conexiones Cerebrales
Notas relacionadas en tu bóveda de conocimiento:
${conexiones.map(c => `- [[${c}]]`).join('\n')}
`;
    }

    // Transcripción removida del output visual, solo se usa para el LLM.

    if (verificacionSintetizada) {
        md += `
---

## 🔍 Contexto & Verificación Web
**Síntesis de la investigación web:**
${verificacionSintetizada}

*Fuentes consultadas:*
${verificacionResult.results.slice(0, 3).map(r => `- [${r.title}](${r.url})`).join('\n')}
`;
    } else if (verificacionResult && verificacionResult.results && verificacionResult.results.length > 0) {
        md += `
---

## 🔍 Contexto & Verificación Web (Fragmentos crudos)
${verificacionResult.results.map(r => `- [${r.title}](${r.url})`).join('\n')}
`;
    }

    md += `
---
*Nota generada automáticamente por el Segundo Cerebro de Arturo.*
`;

    if (timers) {
        const seg = (ms) => (ms / 1000).toFixed(1) + 's';
        const min = (ms) => (ms / 60000).toFixed(1) + 'm';
        md += `
---

## ⏱️ Rendimiento del Análisis Profundo
- **Extracción Visual & Audio (Whisper):** ${timers.deep > 60000 ? min(timers.deep) : seg(timers.deep)}
- **Análisis Lógico (Ollama):** ${timers.ollama > 60000 ? min(timers.ollama) : seg(timers.ollama)}
- **Búsqueda Web (Tavily):** ${timers.tavily > 0 ? seg(timers.tavily) : 'N/A'}
- **Tiempo Total Procesamiento:** ${timers.total > 60000 ? min(timers.total) : seg(timers.total)}
`;
    }

    return md;
}



module.exports = {
    analizarYVerificarMedia,
    ejecutarAnalisisEncolado
};

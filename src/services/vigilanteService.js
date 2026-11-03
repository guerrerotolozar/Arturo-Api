const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { ChatOllama } = require("@langchain/ollama");
const { OLLAMA_MODEL, OLLAMA_URL, VAULT_PATH_BOVEDA } = require('../config/env');
const { buscarSemanticamente, estaDisponible, inicializar } = require('../repositories/vectorRepository');

/**
 * Extrae metadatos clave del frontmatter YAML v2 de una nota.
 */
function _extraerFrontmatter(contenido) {
    const match = String(contenido || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const fm = match[1];
    const getScalar = (key) => {
        const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    return {
        id: getScalar('id'),
        tipo: getScalar('tipo'),
        estado: getScalar('estado') || 'activo',
        resumen: getScalar('resumen')
    };
}

/**
 * Descubre dinámicamente todos los proyectos e infraestructuras financieras de la Bóveda
 * leyendo su frontmatter v2 (sin listas hardcodeadas).
 */
function _descubrirProyectosBoveda() {
    const rutasBase = [
        path.join(VAULT_PATH_BOVEDA, 'OPERACIONES', 'Proyectos'),
        path.join(VAULT_PATH_BOVEDA, 'OPERACIONES', 'Finanzas')
    ];
    const catalogo = new Map(); // rutaRelativaNormalizada -> infoProyecto

    function escanear(dir) {
        if (!fs.existsSync(dir)) return;
        const entradas = fs.readdirSync(dir, { withFileTypes: true });
        for (const entrada of entradas) {
            const fullPath = path.join(dir, entrada.name);
            if (entrada.isDirectory()) {
                if (entrada.name.startsWith('.')) continue;
                escanear(fullPath);
            } else if (entrada.isFile() && entrada.name.endsWith('.md')) {
                if (entrada.name.startsWith('Bitacora_Ordenes_')) continue;
                try {
                    const contenido = fs.readFileSync(fullPath, 'utf8');
                    const meta = _extraerFrontmatter(contenido);
                    const rutaRel = path.relative(VAULT_PATH_BOVEDA, fullPath).replace(/\\/g, '/');
                    const nombreNota = path.basename(fullPath, '.md');
                    const partes = rutaRel.split('/');
                    // OPERACIONES/Proyectos/<CarpetaProyecto>/<Nota>.md
                    const carpetaProyecto = partes.length >= 3 ? partes[2].replace(/\.md$/, '') : nombreNota;
                    catalogo.set(rutaRel, {
                        nombreNota,
                        carpetaProyecto,
                        rutaRelativa: rutaRel,
                        rutaAbsoluta: fullPath,
                        id: meta.id || `proyecto.${nombreNota.toLowerCase()}`,
                        tipo: meta.tipo || 'proyecto',
                        estado: (meta.estado || 'activo').toLowerCase(),
                        resumen: meta.resumen || ''
                    });
                } catch {
                    // Ignorar archivos ilegibles
                }
            }
        }
    }

    for (const base of rutasBase) escanear(base);
    return catalogo;
}

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
    } catch (e) {
        console.warn(`[VIGILANTE] Error leyendo Media:`, e.message);
        return;
    }

    const huerfanos = [];

    for (const d of folders) {
        if (!d.isDirectory() || d.name === '_Huerfanos') continue;
        const fPath = path.join(mediaDir, d.name);
        const mdFile = fs.readdirSync(fPath).find(f => f.endsWith('.md'));
        if (mdFile) {
            const mdPath = path.join(fPath, mdFile);
            const content = fs.readFileSync(mdPath, 'utf8');

            // Es candidato a curaduría si tiene curado_vigilante: false o aún no tiene bloque de Conexiones Cerebrales
            const pendienteCuraduria = content.includes('curado_vigilante: false') || !content.includes('## 🧠 Conexiones Cerebrales');
            if (pendienteCuraduria) {
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
He encontrado esta nota multimedia en la bandeja de entrada. Contiene información técnica o conceptual valiosa que debe sintetizarse e integrarse a la bóveda principal.

Tu tarea es leer el contenido de esta nota y generar una "Nota Conceptual" universal, atemporal y aplicable a proyectos de ingeniería de software, arquitectura, automatización o producto.
La nueva nota debe extraer los conceptos teóricos, patrones de diseño, flujos técnicos y buenas prácticas fundamentales. NO hagas referencia a "el autor del video dice" o "en el video se muestra". Debe redactarse como una wiki de conocimiento puro y aplicable.

ESTRUCTURA DE CARPETAS ACTUAL (v2):
Tu conocimiento debe guardarse dentro de la carpeta: "OPERACIONES/Conceptos".
Allí existen subcarpetas cerradas por dominio:
- IA
- Agentes
- Desarrollo
- Automatizacion
- Datos
- Multimedia

Elige la ruta más adecuada entre esas subcarpetas de "OPERACIONES/Conceptos" (ej: "OPERACIONES/Conceptos/Desarrollo" o "OPERACIONES/Conceptos/Automatizacion"). No inventes carpetas nuevas; si no encaja, usa "OPERACIONES/_Bandeja".

=== CONTENIDO DE LA NOTA MULTIMEDIA ===
${objetivo.content.substring(0, 8000)}
=======================================`;

    try {
        const baseUrl = OLLAMA_URL.replace('/api/generate', '').replace('/api/chat', '');
        const llm = new ChatOllama({ baseUrl, model: OLLAMA_MODEL, temperature: 0.2 });

        const schemaCuraduria = z.object({
            ruta_relativa: z.string().describe("Ruta del vault donde se guardará la nota. Ej: OPERACIONES/Conceptos/Desarrollo"),
            titulo_nota: z.string().describe("Un título corto, descriptivo y universal (Ej: Gestion de Comprobantes y Flujos de Impresion)"),
            resumen_corto: z.string().optional().describe("Resumen de 1 a 2 líneas sobre qué resuelve este concepto y dónde aplica"),
            contenido_markdown: z.string().describe("Contenido teórico y práctico detallado formateado en Markdown. Incluye el # Título principal.")
        });

        const llmConEstructura = llm.withStructuredOutput(schemaCuraduria, { name: "nota_conceptual" });

        console.log(`[VIGILANTE] 🧠 Sintetizando concepto universal con el modelo de lenguaje (Structured Output)...`);

        const curado = await llmConEstructura.invoke(prompt);

        const tituloBruto = curado.titulo_nota || "Concepto_Curado_Automatico";
        const contenidoBruto = curado.contenido_markdown || "Contenido no generado.";
        let resumenCorto = (curado.resumen_corto || '').trim();
        if (!resumenCorto) {
            const primeraLinea = contenidoBruto.split('\n').find(l => l.trim() && !l.trim().startsWith('#'));
            resumenCorto = (primeraLinea || tituloBruto).replace(/[*_`>-]/g, '').trim().substring(0, 220);
        }

        let rutaRelativa = curado.ruta_relativa || 'OPERACIONES/_Bandeja';
        if (rutaRelativa.includes('Laboratorio Tech/Conceptos')) {
            rutaRelativa = rutaRelativa.replace('OPERACIONES/Laboratorio Tech/Conceptos', 'OPERACIONES/Conceptos');
        }

        const safeTitle = String(tituloBruto).replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ0-9\s_-]/g, '').trim().replace(/\s+/g, '_');
        const slugId = safeTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

        // Extraer resumen ejecutivo del video original para enriquecer la búsqueda vectorial
        const matchResumenOrig = objetivo.content.match(/## 📝 Resumen Ejecutivo\r?\n([\s\S]*?)(\r?\n---|\r?\n## |$)/);
        const resumenOriginal = matchResumenOrig ? matchResumenOrig[1].trim() : '';
        const queryEnriquecida = `${tituloBruto}. ${resumenCorto}. ${resumenOriginal}`.trim();

        const catalogoProyectos = _descubrirProyectosBoveda();
        const mediaNombreSinExt = path.basename(objetivo.mdFile, '.md');
        const wikilinkMedia = `[[Media/${objetivo.timestampName}/${mediaNombreSinExt}]]`;
        const fechaHoy = new Date().toISOString().slice(0, 10);

        // ================================================================
        // 1. BÚSQUEDA VECTORIAL UNIFICADA (Oportunidades + Anti-Duplicados)
        // ================================================================
        let topProyectos = [];
        let topConocimiento = [];
        let candidatoFusion = null;

        try {
            const disponible = await estaDisponible();
            if (disponible) {
                await inicializar();
                const [conexionesProyectos, conexionesGenerales] = await Promise.all([
                    buscarSemanticamente(queryEnriquecida, 20, [], { soloProyectos: true }),
                    buscarSemanticamente(queryEnriquecida, 20, [], { excluirMedia: true })
                ]);
                const conexiones = [...conexionesProyectos, ...conexionesGenerales];

                // Deduplicar por ruta conservando la menor distancia coseno
                const mejorPorRuta = new Map();
                for (const r of conexiones) {
                    if (!r.metadata || !r.metadata.ruta) continue;
                    const rutaNorm = r.metadata.ruta.replace(/\\/g, '/');
                    if (rutaNorm.includes('/Media/') || rutaNorm.startsWith('Media/')) continue;
                    if (rutaNorm.includes('Bitacora_Ordenes_')) continue;

                    const prev = mejorPorRuta.get(rutaNorm);
                    if (!prev || r.distancia < prev.distancia) {
                        mejorPorRuta.set(rutaNorm, { ...r, rutaNorm });
                    }
                }

                const hitsProyectos = [];
                const hitsConceptos = [];
                const hitsOtros = [];

                for (const [rutaNorm, hit] of mejorPorRuta.entries()) {
                    const infoProy = catalogoProyectos.get(rutaNorm);
                    if (infoProy && hit.distancia < 0.48) {
                        const bonusActivo = (infoProy.estado === 'produccion' || infoProy.estado === 'activo') ? -0.03 : 0;
                        hitsProyectos.push({
                            ...infoProy,
                            distancia: hit.distancia,
                            scoreOrden: hit.distancia + bonusActivo
                        });
                    } else if (!infoProy) {
                        const item = {
                            nombreNota: path.basename(rutaNorm, '.md'),
                            rutaNorm,
                            distancia: hit.distancia
                        };
                        if (rutaNorm.includes('OPERACIONES/Conceptos/')) {
                            hitsConceptos.push(item);
                        } else if (hit.distancia < 0.43) {
                            hitsOtros.push(item);
                        }
                    }
                }

                hitsProyectos.sort((a, b) => a.scoreOrden - b.scoreOrden);
                hitsConceptos.sort((a, b) => a.distancia - b.distancia);
                hitsOtros.sort((a, b) => a.distancia - b.distancia);

                topProyectos = hitsProyectos.slice(0, 3);

                // Umbral de Fusión Tangible (Staged Ingestion): distancia coseno < 0.38 (similitud > 62%)
                if (hitsConceptos.length > 0 && hitsConceptos[0].distancia < 0.38) {
                    candidatoFusion = hitsConceptos[0];
                    topConocimiento = [...hitsConceptos.slice(1).filter(c => c.distancia < 0.43), ...hitsOtros].slice(0, 3);
                } else {
                    topConocimiento = [...hitsConceptos.filter(c => c.distancia < 0.43), ...hitsOtros].slice(0, 3);
                }
            }
        } catch (errVector) {
            console.warn(`[VIGILANTE] ⚠️  Error en análisis vectorial: ${errVector.message}`);
        }

        // ================================================================
        // 2. FUSIÓN TANGIBLE EN DOS FASES (Si ya existe concepto hermano)
        // ================================================================
        if (candidatoFusion) {
            const rutaExistente = path.join(VAULT_PATH_BOVEDA, candidatoFusion.rutaNorm);
            if (fs.existsSync(rutaExistente)) {
                const nombreExistente = candidatoFusion.nombreNota;
                const simPct = Math.round((1 - candidatoFusion.distancia) * 100);
                console.log(`[VIGILANTE] 🔄 Concepto hermano detectado (${simPct}% similitud, dist: ${candidatoFusion.distancia.toFixed(3)}): "${nombreExistente}"`);
                console.log(`[VIGILANTE] 📎 Inyectando sección de Ampliación Tangible en "${nombreExistente}.md" (cero duplicación de archivo).`);

                let contenidoExistente = fs.readFileSync(rutaExistente, 'utf8');

                // Limpiar título H1 redundante y bajar un nivel los encabezados internos para anidar limpio bajo ## 📎 Ampliación
                const cuerpoLimpio = String(contenidoBruto || '')
                    .replace(/^#\s+.*\r?\n+/, '')
                    .replace(/^(#{2,5})\s+/gm, '#$1 ')
                    .trim();

                const proysAplicablesStr = topProyectos.length > 0
                    ? `\n- **Proyectos Aplicables:** ${topProyectos.map(p => `[[${p.nombreNota}]] *(${p.estado})*`).join(', ')}`
                    : '';

                const bloqueAmpliacion = `\n\n---\n\n## 📎 Ampliación (${fechaHoy}): ${tituloBruto}\n- **Origen:** ${wikilinkMedia}\n- **Síntesis:** ${resumenCorto}${proysAplicablesStr}\n\n${cuerpoLimpio}\n`;

                // Insertar antes de ## 💡 Oportunidades de Aplicación o antes de <!-- auto:begin -->
                if (contenidoExistente.includes('## 💡 Oportunidades de Aplicación')) {
                    contenidoExistente = contenidoExistente.replace(
                        /(\r?\n---\r?\n+\s*## 💡 Oportunidades de Aplicación|\r?\n## 💡 Oportunidades de Aplicación)/,
                        `${bloqueAmpliacion}$1`
                    );
                } else if (contenidoExistente.includes('<!-- auto:begin -->')) {
                    contenidoExistente = contenidoExistente.replace(
                        /(\r?\n*<!-- auto:begin -->)/,
                        `${bloqueAmpliacion}\n\n$1`
                    );
                } else {
                    contenidoExistente = contenidoExistente.trimEnd() + bloqueAmpliacion + '\n';
                }

                // Actualizar fecha en frontmatter
                contenidoExistente = contenidoExistente.replace(/^actualizado:\s*.*$/m, `actualizado: ${fechaHoy}`);

                // Añadir nuevos proyectos detectados a la sección de Oportunidades si no estaban
                for (const proy of topProyectos) {
                    if (!contenidoExistente.includes(`[[${proy.nombreNota}]]`) && contenidoExistente.includes('## 💡 Oportunidades de Aplicación')) {
                        const etiquetaEstado = (proy.estado === 'pausado' || proy.estado === 'archivado')
                            ? ` *(referencia técnica / ${proy.estado})*`
                            : ` *(${proy.estado})*`;
                        const similitudProy = Math.round((1 - proy.distancia) * 100);
                        const lineaProy = `- **[[${proy.nombreNota}]]**${etiquetaEstado} — afinidad semántica ${similitudProy}%: ${proy.resumen || 'Aplicación directa en arquitectura o interfaz.'}`;
                        contenidoExistente = contenidoExistente.replace(
                            /(## 💡 Oportunidades de Aplicación\r?\n(?:Este concepto tiene conexión directa con los siguientes proyectos del ecosistema:\r?\n)?)/,
                            `$1${lineaProy}\n`
                        );
                    }
                }

                fs.writeFileSync(rutaExistente, contenidoExistente, 'utf8');
                console.log(`[VIGILANTE] ✔️  Ampliación tangible guardada en: ${nombreExistente}.md`);

                const enlacesParaMedia = [nombreExistente, ...topProyectos.map(p => p.nombreNota)];
                _inyectarEnlaceEnHuerfano(objetivo, enlacesParaMedia);

                for (const proy of topProyectos) {
                    if (proy.estado === 'activo' || proy.estado === 'produccion') {
                        _inyectarOportunidadEnProyecto(proy, nombreExistente, mediaNombreSinExt, resumenCorto);
                    }
                }

                // Disparar Semantic Bridge UNA SOLA VEZ sobre el concepto ampliado
                const { enqueue } = require('./gpuQueueService');
                enqueue('semantic_bridge', 3, { notasAnalizadas: [candidatoFusion.rutaNorm] });
                console.log(`[VIGILANTE] 🌉 Semantic Bridge encolado (1 sola vez) para evaluar impacto de "${nombreExistente}".`);
                console.log(`[VIGILANTE] Curaduría completada (ampliación tangible). Quedan ${huerfanos.length - 1} en cola.`);
                return;
            }
        }

        // ================================================================
        // 3. CREACIÓN DE NOTA CONCEPTUAL NUEVA (Si es un dominio nuevo)
        // ================================================================
        const targetDir = path.join(VAULT_PATH_BOVEDA, rutaRelativa);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log(`[VIGILANTE] Nueva subcarpeta creada: ${rutaRelativa}`);
        }

        const newNotePath = path.join(targetDir, `${safeTitle}.md`);
        let seccionOportunidades = '';
        const enlacesParaMedia = [safeTitle];
        const enlacesRelacionadosFrontmatter = [wikilinkMedia];

        if (topProyectos.length > 0 || topConocimiento.length > 0) {
            const nombresProyLog = topProyectos.map(p => `${p.nombreNota} (${Math.round((1 - p.distancia) * 100)}%, ${p.estado})`);
            if (nombresProyLog.length > 0) {
                console.log(`[VIGILANTE] 💡 Oportunidad detectada en proyecto(s): [${nombresProyLog.join(', ')}]`);
            }

            seccionOportunidades = `\n\n---\n\n## 💡 Oportunidades de Aplicación\n`;
            if (topProyectos.length > 0) {
                seccionOportunidades += `Este concepto tiene conexión directa con los siguientes proyectos del ecosistema:\n`;
                for (const proy of topProyectos) {
                    const etiquetaEstado = (proy.estado === 'pausado' || proy.estado === 'archivado')
                        ? ` *(referencia técnica / ${proy.estado})*`
                        : ` *(${proy.estado})*`;
                    const similitudPct = Math.round((1 - proy.distancia) * 100);
                    seccionOportunidades += `- **[[${proy.nombreNota}]]**${etiquetaEstado} — afinidad semántica ${similitudPct}%: ${proy.resumen || 'Aplicación directa en arquitectura o interfaz.'}\n`;

                    if (!enlacesParaMedia.includes(proy.nombreNota)) {
                        enlacesParaMedia.push(proy.nombreNota);
                    }
                    const wikilink = `[[${proy.nombreNota}]]`;
                    if (!enlacesRelacionadosFrontmatter.includes(wikilink)) {
                        enlacesRelacionadosFrontmatter.push(wikilink);
                    }
                }
            }

            if (topConocimiento.length > 0) {
                seccionOportunidades += `\nNotas conceptuales y herramientas relacionadas:\n`;
                for (const n of topConocimiento) {
                    seccionOportunidades += `- [[${n.nombreNota}]]\n`;
                    const wikilink = `[[${n.nombreNota}]]`;
                    if (!enlacesRelacionadosFrontmatter.includes(wikilink)) {
                        enlacesRelacionadosFrontmatter.push(wikilink);
                    }
                }
            }

            seccionOportunidades += `\n> *Oportunidad detectada dinámicamente por El Vigilante (qwen3-embedding:8b).* \n`;
        }

        const finalNoteContent = `---
id: concepto.${slugId}
tipo: concepto
resumen: "${resumenCorto.replace(/"/g, "'")}"
estado: activo
actualizado: ${fechaHoy}
origen: "${wikilinkMedia}"
anclas: []
relacionados:
${enlacesRelacionadosFrontmatter.map(r => `  - "${r}"`).join('\n')}
---

${contenidoBruto}
${seccionOportunidades}

<!-- auto:begin -->
*Concepto extraído y curado automáticamente por El Vigilante desde ${wikilinkMedia}.*
<!-- auto:end -->
`;

        // Crear la nueva nota conceptual
        fs.writeFileSync(newNotePath, finalNoteContent, 'utf8');
        console.log(`[VIGILANTE] ✔️  Nueva Nota Conceptual v2 creada en ${rutaRelativa}: ${safeTitle}.md`);

        // Inyectar enlaces en el archivo de Media original y marcar curado_vigilante: true
        _inyectarEnlaceEnHuerfano(objetivo, enlacesParaMedia);

        // Inyectar backlink reactivo en la zona <!-- auto:begin --> de los proyectos activos impactados
        for (const proy of topProyectos) {
            if (proy.estado === 'activo' || proy.estado === 'produccion') {
                _inyectarOportunidadEnProyecto(proy, safeTitle, mediaNombreSinExt, resumenCorto);
            }
        }

        // Disparar Semantic Bridge UNA SOLA VEZ sobre la nueva nota conceptual consolidada
        const { enqueue } = require('./gpuQueueService');
        const rutaRelNueva = path.relative(VAULT_PATH_BOVEDA, newNotePath).replace(/\\/g, '/');
        enqueue('semantic_bridge', 3, { notasAnalizadas: [rutaRelNueva] });
        console.log(`[VIGILANTE] 🌉 Semantic Bridge encolado (1 sola vez) para evaluar impacto de "${safeTitle}".`);
        console.log(`[VIGILANTE] Curaduría completada con éxito. Quedan ${huerfanos.length - 1} en cola.`);

    } catch (e) {
        console.error(`[VIGILANTE] ❌ Error en la curaduría:`, e.message);
    }
}

/**
 * Inyecta o actualiza el bloque de Conexiones Cerebrales en la nota de Media original
 * y actualiza la bandera curado_vigilante: true.
 */
function _inyectarEnlaceEnHuerfano(objetivo, titulosNotas) {
    try {
        const listaTitulos = Array.isArray(titulosNotas) ? titulosNotas : [titulosNotas];
        let content = fs.existsSync(objetivo.mdPath) ? fs.readFileSync(objetivo.mdPath, 'utf8') : objetivo.content;

        // Actualizar flag curado_vigilante en frontmatter
        if (content.includes('curado_vigilante: false')) {
            content = content.replace('curado_vigilante: false', 'curado_vigilante: true');
        } else if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
            content = content.replace(/^---\r?\n/, '---\ncurado_vigilante: true\n');
        }

        if (content.includes('## 🧠 Conexiones Cerebrales')) {
            // Añadir enlaces faltantes al bloque existente sin duplicar
            const nuevosBullets = listaTitulos
                .filter(t => !content.includes(`[[${t}]]`))
                .map(t => `- [[${t}]]`)
                .join('\n');

            if (nuevosBullets) {
                content = content.replace(
                    /(## 🧠 Conexiones Cerebrales\r?\n(?:Notas relacionadas en tu bóveda de conocimiento:\r?\n)?)/,
                    `$1${nuevosBullets}\n`
                );
            }
        } else {
            const block = `\n---\n\n## 🧠 Conexiones Cerebrales\nNotas relacionadas en tu bóveda de conocimiento:\n${listaTitulos.map(t => `- [[${t}]]`).join('\n')}\n`;
            if (content.includes('*Nota generada automáticamente')) {
                content = content.replace(/---\r?\n\*Nota generada automáticamente/, `${block}\n---\n*Nota generada automáticamente`);
            } else {
                content += block;
            }
        }

        fs.writeFileSync(objetivo.mdPath, content, 'utf8');
        console.log(`[VIGILANTE] 🔗 Enlaces [${listaTitulos.join(', ')}] inyectados exitosamente en ${objetivo.mdFile}.`);
    } catch (errLink) {
        console.warn(`[VIGILANTE] ⚠️  Error inyectando enlace: ${errLink.message}`);
    }
}

/**
 * Inyecta una referencia de oportunidad en la zona <!-- auto:begin --> ... <!-- auto:end -->
 * de la nota maestra de un proyecto activo (ej. OasisStore.md) sin tocar el cuerpo humano.
 */
function _inyectarOportunidadEnProyecto(proyecto, conceptoTitulo, mediaTitulo, resumenCorto) {
    try {
        if (!fs.existsSync(proyecto.rutaAbsoluta)) return;
        const contenido = fs.readFileSync(proyecto.rutaAbsoluta, 'utf8');
        if (contenido.includes(`[[${conceptoTitulo}]]`)) return; // Ya está enlazado

        const fecha = new Date().toISOString().slice(0, 10);
        const lineaOportunidad = `- **${fecha}** · Concepto aplicable: [[${conceptoTitulo}]] *(origen: [[${mediaTitulo}]])* — ${resumenCorto}`;

        const regexAuto = /<!-- auto:begin -->([\s\S]*?)<!-- auto:end -->/;
        const matchAuto = contenido.match(regexAuto);
        if (!matchAuto) return;

        let interior = matchAuto[1];
        const headerSeccion = '### 💡 Oportunidades y Conceptos Aplicables (Vigilante)';
        if (interior.includes(headerSeccion)) {
            interior = interior.replace(headerSeccion, `${headerSeccion}\n${lineaOportunidad}`);
        } else {
            interior = `${interior.trimEnd()}\n\n${headerSeccion}\n${lineaOportunidad}\n`;
        }

        const nuevoContenido = contenido.replace(regexAuto, `<!-- auto:begin -->${interior}<!-- auto:end -->`);
        fs.writeFileSync(proyecto.rutaAbsoluta, nuevoContenido, 'utf8');
        console.log(`[VIGILANTE] 🚀 Oportunidad inyectada en proyecto activo: ${proyecto.nombreNota}.md -> [[${conceptoTitulo}]]`);
    } catch (errProy) {
        console.warn(`[VIGILANTE] ⚠️  No se pudo inyectar oportunidad en ${proyecto.nombreNota}: ${errProy.message}`);
    }
}

module.exports = {
    ejecutarCuraduria,
    ejecutarCuraduriaEncolada,
    _descubrirProyectosBoveda
};

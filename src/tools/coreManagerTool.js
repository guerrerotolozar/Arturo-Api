const fs = require('fs');
const path = require('path');
const { PROMPTS_PATH, PERFIL_RONALD } = require('../config/env');

const nombre = "core_manager";
const descripcion = `Permite a Arturo (tú) leer y auto-modificar permanentemente sus propios archivos de personalidad (Prompts Core) en la Bóveda. 
Obligatorio usar si el usuario te pide "cambia tu forma de hablar", "nunca vuelvas a decir X", o "modifica tu núcleo".
Parámetros JSON:
- action: "list_prompts" (para ver qué archivos puedes editar), "read_prompt" (para leer el contenido actual), o "append_rule" (para inyectar una regla nueva al final del archivo).
- filename: Nombre del archivo a modificar (ej. "ia_fast.md" o "perfil_ronald").
- rule_text: (Solo para append_rule) El texto exacto de la nueva regla a agregar. Sé directo y claro.`;

/**
 * @param {Object} params
 * @param {string} params.action - 'list_prompts', 'read_prompt', 'append_rule'
 * @param {string} [params.filename] - Nombre del archivo o 'perfil_ronald'
 * @param {string} [params.rule_text] - Regla a inyectar
 */
async function ejecutar(params) {
    const { action, filename, rule_text } = params;

    if (!PROMPTS_PATH) {
        return { resumen: "Error: PROMPTS_PATH no configurado en el servidor." };
    }

    try {
        switch (action) {
            case 'list_prompts': {
                if (!fs.existsSync(PROMPTS_PATH)) return { resumen: `Error: No existe el directorio ${PROMPTS_PATH}` };
                
                const files = fs.readdirSync(PROMPTS_PATH).filter(f => f.endsWith('.md'));
                const list = files.join(', ');
                let res = `Archivos de sistema (Prompts) disponibles para editar:\n${list}`;
                if (PERFIL_RONALD && fs.existsSync(PERFIL_RONALD)) {
                    res += `\nTambién tienes acceso a: perfil_ronald`;
                }
                return { resumen: res };
            }

            case 'read_prompt': {
                if (!filename) return { resumen: "Error: Debes proveer 'filename' para read_prompt." };
                
                let targetPath;
                if (filename === 'perfil_ronald') {
                    targetPath = PERFIL_RONALD;
                } else {
                    targetPath = path.join(PROMPTS_PATH, filename);
                }

                if (!fs.existsSync(targetPath)) return { resumen: `Error: Archivo ${filename} no encontrado en ${targetPath}` };
                
                const content = fs.readFileSync(targetPath, 'utf8');
                return { 
                    resumen: `Contenido actual de ${filename}:\n\n${content}`,
                    datos: content
                };
            }

            case 'append_rule': {
                if (!filename || !rule_text) return { resumen: "Error: Faltan 'filename' o 'rule_text' para append_rule." };

                let targetPath;
                if (filename === 'perfil_ronald') {
                    targetPath = PERFIL_RONALD;
                } else {
                    targetPath = path.join(PROMPTS_PATH, filename);
                }

                if (!fs.existsSync(targetPath)) return { resumen: `Error: Archivo ${filename} no encontrado.` };

                // Formatear la regla para que quede bien en Markdown
                const timestamp = new Date().toISOString().split('T')[0];
                const cleanRule = rule_text.trim();
                const injectString = `\n\n- [AGREGADO POR RONALD ${timestamp}]: ${cleanRule}\n`;

                fs.appendFileSync(targetPath, injectString, 'utf8');

                return { 
                    resumen: `✅ Éxito absoluto. He inyectado la nueva regla en ${filename}. Los cambios son permanentes.`,
                    datos: { file: filename, rule_added: cleanRule }
                };
            }

            default:
                return { resumen: "Error: 'action' no válida. Usa list_prompts, read_prompt o append_rule." };
        }
    } catch (err) {
        return { resumen: `Error interno de coreManagerTool: ${err.message}` };
    }
}

module.exports = { nombre, descripcion, ejecutar };

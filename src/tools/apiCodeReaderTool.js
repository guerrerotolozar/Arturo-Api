const fs = require('fs');
const path = require('path');

const nombre = "api_code_reader";
const descripcion = `Permite a Arturo auditar y leer su propio código fuente de la API (.js, .json, .env). 
Usa esta herramienta cuando Ronald te pida hacer una auditoría, entender cómo funciona tu backend, o revisar código.
Parámetros JSON:
- action: "list" (para listar archivos en una subcarpeta), "read" (para leer un archivo), o "audit_directory" (para leer TODOS los archivos .js de una subcarpeta a la vez).
- targetPath: Ruta relativa. Ejemplo: "src/controllers", "src/services" o "src/adapters/videoAdapter.js". Para audit_directory, NO uses la raíz (""), especifica una subcarpeta.`;

/**
 * @param {Object} params
 * @param {string} params.action - 'list', 'read' o 'audit_directory'
 * @param {string} [params.targetPath] - Ruta relativa. Por defecto '' (raíz).
 */
async function ejecutar(params) {
    const { action, targetPath = '' } = params;

    try {
        // __dirname es src/tools. El root de la API es ../../
        const apiRoot = path.resolve(__dirname, '../../');
        
        // Evitar path traversal fuera del directorio de la API (pero sí permite todo dentro, incluyendo .env)
        const safePath = path.resolve(apiRoot, targetPath);
        if (!safePath.startsWith(apiRoot)) {
            return { resumen: `Error de seguridad: No tienes permiso para leer fuera del directorio base de la API.` };
        }

        if (!fs.existsSync(safePath)) {
            return { resumen: `Error: La ruta '${targetPath}' no existe en la API.` };
        }

        const stat = fs.statSync(safePath);

        if (action === 'list') {
            if (!stat.isDirectory()) {
                return { resumen: `Error: '${targetPath}' es un archivo. Usa action="read" para leer su contenido.` };
            }
            const files = fs.readdirSync(safePath);
            return { 
                resumen: `Archivos y carpetas en '${targetPath || 'raíz del proyecto'}':\n${files.join('\n')}`,
                datos: files
            };
        } else if (action === 'read') {
            if (stat.isDirectory()) {
                return { resumen: `Error: '${targetPath}' es un directorio. Usa action="list" para ver su contenido.` };
            }
            const content = fs.readFileSync(safePath, 'utf8');
            return { 
                resumen: `Contenido fuente de ${targetPath}:\n\n${content}`,
                datos: { file: targetPath, content }
            };
        } else if (action === 'audit_directory') {
            if (!stat.isDirectory()) {
                return { resumen: `Error: '${targetPath}' no es un directorio. Usa action="read" si es un solo archivo.` };
            }
            
            const blackList = ['node_modules', '.git', 'lancedb_data', 'dist', 'coverage', '.env'];
            const allJsFiles = [];
            
            function walkDir(dir) {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (blackList.includes(entry.name)) continue;
                    
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walkDir(fullPath);
                    } else if (entry.isFile() && entry.name.endsWith('.js')) {
                        allJsFiles.push(fullPath);
                    }
                }
            }
            
            walkDir(safePath);
            
            if (allJsFiles.length === 0) return { resumen: `No hay archivos .js en ${targetPath || 'la raíz'}` };
            
            let combinedContent = `AUDITORÍA GLOBAL DE DIRECTORIO: ${targetPath || 'RAÍZ DE LA API'}\n\n`;
            for (const fp of allJsFiles) {
                const relName = path.relative(apiRoot, fp);
                const statFile = fs.statSync(fp);
                if (statFile.size > 50000) { 
                    combinedContent += `\n// --- Archivo omitido por tamaño excesivo (>50KB): ${relName} ---\n`;
                    continue;
                }
                const content = fs.readFileSync(fp, 'utf8');
                combinedContent += `\n// ==========================================\n// ARCHIVO: ${relName}\n// ==========================================\n${content}\n`;
            }
            
            return {
                resumen: `Código consolidado de ${allJsFiles.length} archivos en '${targetPath || 'toda la API'}'. Analízalos cuidadosamente en conjunto:\n\n${combinedContent}`,
                datos: { directory: targetPath || 'root', files_read: allJsFiles.length }
            };
        } else {
            return { resumen: "Error: action inválida. Usa 'list', 'read' o 'audit_directory'." };
        }
    } catch (err) {
        return { resumen: `Error interno de apiCodeReaderTool: ${err.message}` };
    }
}

module.exports = { nombre, descripcion, ejecutar };

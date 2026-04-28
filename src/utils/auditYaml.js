require('dotenv').config();
const fs = require('fs');
const path = require('path');

const VAULT_PATH = process.env.VAULT_PATH;
const isDryRun = process.argv.includes('--dry-run');

if (!VAULT_PATH || !fs.existsSync(VAULT_PATH)) {
    console.error(`❌ Error: VAULT_PATH no está definido o no existe (${VAULT_PATH})`);
    process.exit(1);
}

console.log(`\n🔍 Iniciando Auditoría de Metadatos YAML en: ${VAULT_PATH}`);
if (isDryRun) {
    console.log(`🚧 MODO SIMULACIÓN (--dry-run) - No se modificará ningún archivo.\n`);
} else {
    console.log(`⚠️ MODO REAL - Los archivos serán modificados.\n`);
}

let archivosProcesados = 0;
let archivosAuditados = 0;
let archivosSaltados = 0;

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function processDirectory(dir) {
    const entradas = fs.readdirSync(dir, { withFileTypes: true });

    for (const entrada of entradas) {
        const fullPath = path.join(dir, entrada.name);

        if (entrada.isDirectory()) {
            // Ignorar carpetas ocultas y node_modules
            if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
            processDirectory(fullPath);
        } else if (entrada.name.endsWith('.md')) {
            archivosProcesados++;
            
            try {
                const contenido = fs.readFileSync(fullPath, 'utf-8');
                
                // Verificar si ya tiene frontmatter (comienza con --- y un salto de línea)
                if (contenido.trimStart().startsWith('---')) {
                    archivosSaltados++;
                    continue; // Ya tiene metadatos, no tocar
                }

                // Extraer la fecha de creación real del archivo en Windows
                const stats = fs.statSync(fullPath);
                // En Windows birthtime es la fecha de creación real
                const creationDate = formatDate(stats.birthtime);

                const yamlBlock = [
                    '---',
                    'tipo: nota_auditada',
                    `creado: ${creationDate}`,
                    'tags:',
                    '  - por_auditar',
                    '---',
                    ''
                ].join('\n');

                const nuevoContenido = yamlBlock + '\n' + contenido;
                const pathRelativo = fullPath.replace(VAULT_PATH, '').replace(/^[/\\]+/, '');

                if (isDryRun) {
                    console.log(`[DRY-RUN] Se agregaría YAML a: ${pathRelativo} (Creado: ${creationDate})`);
                } else {
                    fs.writeFileSync(fullPath, nuevoContenido, 'utf-8');
                    console.log(`[MODIFICADO] YAML agregado a: ${pathRelativo}`);
                }

                archivosAuditados++;

            } catch (err) {
                console.error(`[ERROR] No se pudo procesar ${fullPath}: ${err.message}`);
            }
        }
    }
}

// Iniciar proceso
processDirectory(VAULT_PATH);

console.log(`\n📊 RESULTADOS DE LA AUDITORÍA:`);
console.log(`- Archivos .md totales escaneados: ${archivosProcesados}`);
console.log(`- Archivos que YA TENÍAN metadatos: ${archivosSaltados}`);
if (isDryRun) {
    console.log(`- Archivos QUE SE MODIFICARÁN en modo real: ${archivosAuditados}`);
    console.log(`\nPara aplicar los cambios, ejecuta sin el flag --dry-run`);
} else {
    console.log(`- Archivos MODIFICADOS EXITOSAMENTE: ${archivosAuditados}`);
}

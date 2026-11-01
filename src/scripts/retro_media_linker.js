const fs = require('fs');
const path = require('path');
const vectorRepo = require('../repositories/vectorRepository');
const { VAULT_PATH_BOVEDA } = require('../config/env');

async function main() {
    console.log(`[RETRO_LINKER] Iniciando escaneo de la carpeta Media...`);
    let mediaDir = path.join(VAULT_PATH_BOVEDA, 'Media');
    if (!fs.existsSync(mediaDir)) {
        mediaDir = '\\\\100.103.230.95\\Arturo\\Cerebro\\Boveda\\Media';
    }
    const carpetas = fs.readdirSync(mediaDir, { withFileTypes: true });
    
    let total = 0;
    let procesados = 0;
    let sinInfo = 0;
    let yaConectados = 0;

    // Inicializar BD Vectorial (LanceDB)
    await vectorRepo.inicializar();
    console.log(`[RETRO_LINKER] Base de datos vectorial lista.`);

    for (const c of carpetas) {
        if (!c.isDirectory() || c.name === '_Huerfanos') continue;
        total++;
        
        const folderPath = path.join(mediaDir, c.name);
        const files = fs.readdirSync(folderPath);
        const mdFile = files.find(f => f.endsWith('.md'));
        
        if (!mdFile) {
            sinInfo++;
            continue;
        }

        const mdPath = path.join(folderPath, mdFile);
        let content = fs.readFileSync(mdPath, 'utf8');

        // Si ya tiene el bloque, saltamos
        if (content.includes('## 🧠 Conexiones Cerebrales')) {
            yaConectados++;
            continue;
        }

        console.log(`[RETRO_LINKER] 🔍 Analizando: ${mdFile}`);
        
        // Intentar extraer el resumen ejecutivo para usarlo como contexto de búsqueda
        const resumenMatch = content.match(/## 📝 Resumen Ejecutivo\n([\s\S]*?)\n---/);
        let searchQuery = c.name; // fallback al nombre de la carpeta (timestamp)
        if (resumenMatch && resumenMatch[1]) {
            searchQuery = resumenMatch[1].trim();
        }

        // Búsqueda semántica usando LanceDB
        const resultadosVectoriales = await vectorRepo.buscarSemanticamente(searchQuery, 10);
        
        // Filtrar media para quedarse con las notas de conocimiento "Core"
        const resultadosCore = resultadosVectoriales.filter(r => 
            r.metadata && r.metadata.ruta && !r.metadata.ruta.includes('/Media/') && !r.metadata.ruta.includes('\\Media\\')
        );
        
        const titulosUnicos = new Set();
        for (const r of resultadosCore) {
            titulosUnicos.add(path.basename(r.metadata.ruta, '.md'));
            if (titulosUnicos.size >= 4) break; // Máximo 4 para no saturar la nota
        }
        
        const conexiones = Array.from(titulosUnicos);
        
        if (conexiones.length > 0) {
            const block = `\n---\n\n## 🧠 Conexiones Cerebrales\nNotas relacionadas en tu bóveda de conocimiento:\n${conexiones.map(c => `- [[${c}]]`).join('\n')}\n`;
            
            // Inyectar antes del footer si existe, o al final del documento
            if (content.includes('*Nota generada automáticamente')) {
                content = content.replace(/---\n\*Nota generada automáticamente/, `${block}\n---\n*Nota generada automáticamente`);
            } else {
                content += block;
            }
            
            fs.writeFileSync(mdPath, content, 'utf8');
            procesados++;
            console.log(`[RETRO_LINKER] ✔️  Conexiones inyectadas en: ${mdFile}`);
        } else {
            console.log(`[RETRO_LINKER] ⚠️  No se encontraron conexiones para: ${mdFile}`);
        }
    }

    console.log(`\n=== RESUMEN RETRO-LINKER ===`);
    console.log(`Total Carpetas Media : ${total}`);
    console.log(`Sin Información (.md) : ${sinInfo} (Requieren ser procesados desde cero)`);
    console.log(`Ya Conectados        : ${yaConectados}`);
    console.log(`Actualizados Hoy     : ${procesados}`);
    console.log(`============================\n`);
    
    process.exit(0);
}

main().catch(err => {
    console.error(`[RETRO_LINKER] ❌ Error fatal:`, err);
    process.exit(1);
});

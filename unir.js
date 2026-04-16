const fs = require('fs');
const path = require('path');

const outputFile = 'proyecto_completo.txt';
const stream = fs.createWriteStream(outputFile);

/**
 * Lee y escribe el contenido de un archivo en el stream
 */
function escribirArchivo(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    stream.write(`\n--------------------------------------------------\n`);
    stream.write(`ARCHIVO: ${filePath}\n`);
    stream.write(`--------------------------------------------------\n`);
    stream.write(fs.readFileSync(filePath, 'utf8'));
    stream.write(`\n`);
}

/**
 * Lee un directorio recursivamente y vuelca sus archivos
 */
function leerDirectorio(dir) {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            leerDirectorio(filePath);
        } else {
            escribirArchivo(filePath);
        }
    });
}

// 1. Escribimos los archivos base en la raíz de segundo-cerebro-api
escribirArchivo('index.js');
escribirArchivo('package.json'); // Útil para tener el contexto de dependencias

// 2. Leemos exclusivamente la carpeta src/ de forma recursiva
leerDirectorio('src');

stream.end(() => {
    console.log(`¡Listo! Se ha creado el archivo '${outputFile}' conteniendo únicamente el código fuente de index y src. Pesa muy poco y está perfecto para la IA.`);
});

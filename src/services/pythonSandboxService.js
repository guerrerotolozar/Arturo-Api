const { spawn } = require('child_process');
const { writeFileSync, unlinkSync, existsSync } = require('fs');
const path = require('path');
const os = require('os');

const TIMEOUT_MS = 10_000;

/**
 * Ejecuta código Python de forma segura en un proceso aislado.
 * @param {string} codigo - El script de python a ejecutar.
 * @returns {Promise<string>} Resultado (stdout) de la ejecución.
 */
function ejecutarPython(codigo) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(os.tmpdir(), `arturo_calc_${Date.now()}.py`);
        writeFileSync(tmpFile, codigo);

        const stdout = [], stderr = [];
        const proc = spawn('python3', [tmpFile], {
            timeout: TIMEOUT_MS,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
        });

        proc.stdout.on('data', d => stdout.push(d.toString()));
        proc.stderr.on('data', d => stderr.push(d.toString()));

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`No se pudo invocar Python. Asegurate de que 'python3' este instalado. Detalle: ${err.message}`));
        });

        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('Python timeout — ejecución excedió 10s'));
        }, TIMEOUT_MS);

        proc.on('close', code => {
            clearTimeout(timer);
            try { if (existsSync(tmpFile)) unlinkSync(tmpFile); }
            catch (e) { console.warn(`No se pudo borrar temporal:`, e.message); }

            if (code !== 0) reject(new Error(`Python exit ${code}: ${stderr.join('')}`));
            else resolve(stdout.join(''));
        });
    });
}

module.exports = { ejecutarPython };

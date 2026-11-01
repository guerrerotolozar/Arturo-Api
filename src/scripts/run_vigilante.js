const vigilante = require('../services/vigilanteService');

async function main() {
    console.log("[RUN] Disparando ronda manual del Vigilante...");
    await vigilante.ejecutarCuraduria();
    console.log("[RUN] Ronda finalizada.");
    process.exit(0);
}

main().catch(err => {
    console.error("[RUN] Error fatal:", err);
    process.exit(1);
});

const express = require('express');
const router = express.Router();
const sysadminService = require('../services/sysadminService');

// El Bash nos manda esto cuando hay actualización pesada pendiente
router.post('/pesada', async (req, res) => {
    const { paquetes_crudos } = req.body;
    sysadminService.alertarActualizacionPesada(paquetes_crudos).catch(console.error);
    res.status(200).send("OK");
});

// El Bash nos manda esto cuando ya hizo la actualización ligera
router.post('/barata', async (req, res) => {
    const { paquetes_crudos } = req.body;
    sysadminService.procesarActualizacionBarata(paquetes_crudos).catch(console.error);
    res.status(200).send("OK");
});

// El Bash nos manda esto si el driver de NVIDIA explota y se auto-repara
router.post('/alerta-critica', (req, res) => {
    const { driver } = req.body;
    sysadminService.alertarFalloNvidia(driver).catch(console.error);
    res.status(200).send("OK");
});

// El Celular (ArturoApp) llama a este endpoint cuando pulsas el botón
router.post('/accion', (req, res) => {
    const { accion } = req.body; // 'ahora' o 'noche'
    
    if (accion !== 'ahora' && accion !== 'noche') {
        return res.status(400).json({ error: "Acción inválida" });
    }
    
    sysadminService.ejecutarComando(accion);
    res.status(200).json({ status: "Procesando " + accion });
});

module.exports = router;

# Detalle Técnico de Hallazgos — Arturo API

Este documento contiene las reproducciones locales delimitadas, trazas completas de código y casos de regresión para cada vulnerabilidad confirmada en la auditoría.

---

## 1. [HIGH] Path Traversal y Escritura Arbitraria en `POST /api/notas`
* **Identificador:** `arturo-path-traversal-crearnota`
* **Archivo de Entrada y Sumidero:** `src/controllers/nota.js`

### Traza de Ejecución y Evidencia de Código
1. `src/controllers/nota.js:5` (`crearNotaHandler`):
   ```javascript
   const { titulo, contexto, carpeta = 'Inbox' } = req.body;
   ```
2. `src/controllers/nota.js:9-11`:
   ```javascript
   const boveda = process.env.VAULT_PATH_BOVEDA || '/home/ronald/ARTURO/Cerebro/Boveda';
   const rutaCarpeta = path.join(boveda, carpeta);
   const rutaArchivo = path.join(rutaCarpeta, `${titulo}.md`);
   ```
3. `src/controllers/nota.js:13-15`:
   ```javascript
   if (!fs.existsSync(rutaCarpeta)) {
       fs.mkdirSync(rutaCarpeta, { recursive: true });
   }
   ```
4. `src/controllers/nota.js:19`:
   ```javascript
   fs.appendFileSync(rutaArchivo, contenido, 'utf8');
   ```

### Actor Simulado y Recurso Afectado
* **Actor:** Cliente HTTP con acceso al puerto 3000 (o que provee `X-Arturo-Key`).
* **Recurso:** Sistema de archivos fuera de `VAULT_PATH_BOVEDA` con permisos del proceso (ej. `/tmp/`, `/home/ronald/`).

### Reproducción Delimitada Nativa
```http
POST /api/notas HTTP/1.1
Host: localhost:3000
Content-Type: application/json
X-Arturo-Key: <VALID_KEY>

{
  "titulo": "auditoria_test",
  "contexto": "Prueba de aislamiento de archivo",
  "carpeta": "../../../../tmp"
}
```
**Resultado Observado:** HTTP 201 con respuesta:
```json
{
  "mensaje": "Texto agregado correctamente.",
  "ruta": "/tmp/auditoria_test.md"
}
```
El archivo es creado en `/tmp/auditoria_test.md` fuera de la Bóveda.

### Remediación a Nivel de Código
Reemplazar líneas 10–15 en `src/controllers/nota.js` por:
```javascript
const resolvedBase = path.resolve(boveda);
const safeTitulo = titulo.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
if (!safeTitulo) return res.status(400).json({ error: 'Título inválido.' });

const rutaCarpeta = path.resolve(boveda, carpeta);
if (!rutaCarpeta.startsWith(resolvedBase + path.sep) && rutaCarpeta !== resolvedBase) {
    return res.status(400).json({ error: 'Ruta no permitida fuera de la bóveda.' });
}
const rutaArchivo = path.join(rutaCarpeta, `${safeTitulo}.md`);
```

### Caso de Prueba de Regresión
```javascript
const testPayload = { titulo: "escape", contexto: "data", carpeta: "../../etc" };
// Debe retornar HTTP 400 y no invocar fs.appendFileSync ni crear directorios.
```

---

## 2. [HIGH] Path Traversal en Tool LangChain `guardar_boveda`
* **Identificador:** `arturo-path-traversal-guardarboveda`
* **Archivo de Entrada y Sumidero:** `src/tools/langchainTools.js`

### Traza de Ejecución y Evidencia de Código
1. `src/tools/langchainTools.js:61` (`guardar_boveda`):
   ```javascript
   const guardar_boveda = tool(async (params) => {
   ```
2. `src/tools/langchainTools.js:65`:
   ```javascript
   const destFolder = path.join(VAULT_PATH_BOVEDA, params.carpeta_destino);
   ```
3. `src/tools/langchainTools.js:71`:
   ```javascript
   const safeName = params.titulo.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
   const filePath = path.join(destFolder, `${safeName}.md`);
   ```
4. `src/tools/langchainTools.js:90`:
   ```javascript
   fs.writeFileSync(filePath, markdownFinal, 'utf8');
   ```

### Actor Simulado y Recurso Afectado
* **Actor:** Contexto de razonamiento del LLM manipulado por inyección indirecta de prompts en notas o contenido web analizado.
* **Recurso:** Cualquier ruta del disco escribible por la aplicación.

### Reproducción Delimitada Nativa
Invocación directa de la herramienta con:
```javascript
await guardar_boveda.func({
    titulo: "compromiso",
    carpeta_destino: "../../../../tmp",
    yaml_tipo: "test",
    yaml_estado: "draft",
    yaml_tags: ["sec"],
    yaml_descripcion: "test",
    contenido_markdown: "contenido"
});
```
**Resultado Observado:** Retorna `"Archivo guardado exitosamente en: /tmp/compromiso.md"`.

### Remediación a Nivel de Código
En `src/tools/langchainTools.js`, antes de `fs.mkdirSync`:
```javascript
const resolvedVault = path.resolve(VAULT_PATH_BOVEDA);
const destFolder = path.resolve(VAULT_PATH_BOVEDA, params.carpeta_destino);
if (!destFolder.startsWith(resolvedVault + path.sep) && destFolder !== resolvedVault) {
    return 'Error: La carpeta de destino debe estar dentro de la Bóveda.';
}
```

---

## 3. [HIGH] Evasión Silenciosa y Fallo Funcional en `ipBlocker`
* **Identificador:** `arturo-ipblocker-dysfunctional-bypass`
* **Archivos:** `index.js` y `src/middlewares/ipBlocker.js`

### Traza de Ejecución y Evidencia de Código
1. `index.js:45-46`:
   ```javascript
   app.use((req, res, next) => {
       if (ipBlocker.isBlocked(req.ip)) { ... }
   ```
2. `src/middlewares/ipBlocker.js:58-59`:
   ```javascript
   isBlocked(req) {
       const ip = (req.socket || req).remoteAddress || '127.0.0.1';
   ```
   Como `req` es un string (`"203.0.113.195"`), `"203.0.113.195".remoteAddress` es `undefined`. `ip` adquiere el valor `'127.0.0.1'`.
3. `src/middlewares/ipBlocker.js:63`:
   ```javascript
   if (ip === '127.0.0.1' || ip === '::1' || ...) {
       return false;
   }
   ```
   La condición siempre se cumple. Ninguna IP es bloqueada.

### Actor Simulado y Recurso Afectado
* **Actor:** Escáner automatizado o botnet atacante enviando miles de peticiones hacia rutas sensibles (`/.env`, `/.git`).
* **Recurso:** Capacidad del servidor y protección contra escaneos de reconocimiento.

### Reproducción Delimitada Nativa
```javascript
const ipBlocker = require('./src/middlewares/ipBlocker');
// Simular paso de req.ip como lo hace index.js
console.log(ipBlocker.isBlocked("203.0.113.50")); // Retorna false incondicionalmente
```

### Remediación a Nivel de Código
1. En `index.js:46`: Cambiar `ipBlocker.isBlocked(req.ip)` a `ipBlocker.isBlocked(req)`.
2. En `src/middlewares/ipBlocker.js:59`:
   ```javascript
   const ip = req.ip || (req.socket ? req.socket.remoteAddress : req) || '127.0.0.1';
   ```
3. En `src/middlewares/ipBlocker.js:90`:
   ```javascript
   accessesSensitivePath(req, ip) {
   ```
   Para que las líneas 96 y 104 dispongan de la variable `ip` y no lancen `ReferenceError`.

---

## 4. [MEDIUM] Wildcard CORS Permisivo (`*`)
* **Identificador:** `arturo-cors-wildcard-fallback`
* **Archivo:** `index.js`

### Traza de Ejecución y Evidencia de Código
`index.js:56-68`:
```javascript
app.use((req, res, next) => {
    const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173'];
    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        ...
    } else {
        res.header('Access-Control-Allow-Origin', '*'); // Fallback para desarrollo
        ...
    }
```

### Actor Simulado y Recurso Afectado
* **Actor:** Sitio web malicioso externo cargado en el navegador de la estación de trabajo.
* **Recurso:** Datos devueltos por la API local / en LAN.

### Reproducción Delimitada Nativa
```bash
curl -i -X OPTIONS http://localhost:3000/status -H "Origin: https://malicious.com"
```
**Resultado Observado:** El servidor responde HTTP 200 con encabezado `Access-Control-Allow-Origin: *`.

### Remediación a Nivel de Código
En `index.js:64`: Eliminar la asignación de `Access-Control-Allow-Origin: *`. Si el origen no está en la lista blanca, no emitir el encabezado.

---

## 5. [MEDIUM] Divulgación de Información Interna en `GET /status`
* **Identificador:** `arturo-status-unauthenticated-info-disclosure`
* **Archivos:** `src/middlewares/authGuard.js` y `src/controllers/status.js`

### Traza de Ejecución y Evidencia de Código
1. `src/middlewares/authGuard.js:15`:
   ```javascript
   if (req.path === '/status' && req.method === 'GET') {
       return next();
   }
   ```
2. `src/controllers/status.js:22-23`:
   ```javascript
   res.json({
       servidor: 'Arturo', estado: ollama.ok ? 'operativo' : 'degradado',
       uptime: ...,
       vault: { notas: notas.length, carpetas: carpetas.size, path: VAULT_PATH },
       ollama, tavily: { configurada: !!TAVILY_API_KEY }
   });
   ```

### Actor Simulado y Recurso Afectado
* **Actor:** Cualquier visitante de red sin credenciales.
* **Recurso:** Metadatos de infraestructura local, rutas de archivos del servidor y modelos de inteligencia artificial disponibles.

### Reproducción Delimitada Nativa
```bash
curl -s http://localhost:3000/status
```
**Resultado Observado:** JSON con campo `vault.path` conteniendo `/home/ronald/ARTURO/Cerebro/Boveda` y array `ollama.modelos` listando todos los modelos.

### Remediación a Nivel de Código
En `src/controllers/status.js`, sanitizar la respuesta pública:
```javascript
res.json({
    servidor: 'Arturo',
    estado: ollama.ok ? 'operativo' : 'degradado',
    uptime: `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${up%60}s`
});
```
Mover la información del Vault y Ollama a `/api/admin/status` protegido por `authGuard`.

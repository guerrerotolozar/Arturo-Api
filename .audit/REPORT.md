# Informe de Auditoría de Seguridad — Arturo API

## 1. Configuración de la Auditoría
* **Perfil:** `standard` (Full Audit Mode)
* **Objetivo:** `Z:\API` (`arturo-api`)
* **Referencia de Código:** `5c65325c81af8e1c1fd5fa14b757265b070bda1a` (dirty worktree por saltos de línea)
* **Alcance:** `index.js`, `src/`, `config/`, `scripts/`
* **Política de Ejecución:** `sandboxed-source-and-local-only` (análisis estático en profundidad y validación local de código sin pruebas en despliegues vivos ni llamadas destructivas)
* **Verificación Independiente:** Candidatos analizados y corroborados por un subagente verificador independiente dedicado (`verifier-indep`).
* **Validación de Esquemas:** `validate-findings.cjs` (PASS: 6 findings valid) y `validate-coverage-ledger.cjs` (PASS: 13 coverage units valid).

---

## 2. Resumen de Postura de Seguridad
Arturo API cuenta con una sólida arquitectura v10 orientada a thin controllers, modularidad de servicios de inferencia y aislamiento de tareas pesadas en colas SQLite (`gpu_queue`). Sin embargo, se identificaron **tres vulnerabilidades de severidad Alta** y **dos de severidad Media**:
1. **Ruptura de contención de archivos (Path Traversal):** Tanto el endpoint `POST /api/notas` como la herramienta del agente LangChain `guardar_boveda` permiten escribir o anexar archivos `.md` fuera del vault hacia cualquier directorio del servidor accesible por el proceso debido a la falta de validación canónica en `path.join()`.
2. **Defecto crítico en middleware de seguridad (`ipBlocker`):** Debido a un desajuste de interfaces (`isBlocked(req.ip)` pasando un string en vez de la request), la IP siempre colapsa a `127.0.0.1` y es exonerada incondicionalmente por la lista blanca. En consecuencia, el bloqueo de IPs, protección contra brute-force y detección de rutas prohibidas (`/.env`, `/.git`) está **100% inoperante**.
3. **Exposición Cross-Origin (CORS Wildcard):** El middleware de CORS emite `Access-Control-Allow-Origin: *` como fallback para orígenes no listados, anulando la restricción de navegadores.
4. **Fuga de información en endpoint de salud (`/status`):** El endpoint no requiere autenticación y expone la ruta absoluta en disco del vault, la lista completa de modelos LLM locales y el estado de integración de APIs.

---

## 3. Tabla de Hallazgos Confirmados

| Severidad | Identificador | Título | Límite Afectado | Resultado Observable |
|---|---|---|---|---|
| **HIGH** | `arturo-path-traversal-crearnota` | Path Traversal y Escritura Arbitraria en `POST /api/notas` | Aislamiento de Bóveda | Creación/anexo de archivos `.md` en cualquier directorio arbitrario del host |
| **HIGH** | `arturo-path-traversal-guardarboveda` | Path Traversal en Tool LangChain `guardar_boveda` | Aislamiento de Bóveda | Creación de carpetas y notas `.md` fuera de la bóveda mediante input del agente |
| **HIGH** | `arturo-ipblocker-dysfunctional-bypass` | Evasión Silenciosa y Fallo Funcional en `ipBlocker` | Control Anti-Brute-Force | `isBlocked` siempre retorna `false`; ninguna IP es bloqueada jamás |
| **MEDIUM** | `arturo-cors-wildcard-fallback` | Wildcard `Access-Control-Allow-Origin: *` en CORS | Aislamiento de Navegador | Cualquier sitio web malicioso en internet puede leer endpoints de la API |
| **MEDIUM** | `arturo-status-unauthenticated-info-disclosure` | Divulgación de Rutas y Modelos en `GET /status` | Frontera de Autenticación | Exposición no autenticada de ruta física del Vault y catálogo de modelos de Ollama |

---

## 4. Detalle de Hallazgos Confirmados

### [HIGH] `arturo-path-traversal-crearnota`
* **Ubicación:** `src/controllers/nota.js` (Líneas 5, 9–11, 14, 19, 21)
* **Actor de Menor Confianza:** Cliente HTTP autenticado (o no autenticado si la API key no está configurada).
* **Mecanismo:** La función `crearNotaHandler` extrae `carpeta` y `titulo` directamente de `req.body` y realiza:
  ```javascript
  const rutaCarpeta = path.join(boveda, carpeta);
  const rutaArchivo = path.join(rutaCarpeta, `${titulo}.md`);
  ```
  Sin comprobar si `rutaCarpeta` escapa de `boveda`. Luego invoca `fs.mkdirSync(rutaCarpeta, { recursive: true })` y `fs.appendFileSync(rutaArchivo, contenido, 'utf8')`.
* **Resultado:** Escritura arbitraria de archivos con sufijo `.md` fuera de la Bóveda en ubicaciones como `/tmp/`, directorios de scripts o configuraciones locales.
* **Solución Mínima Efectiva:**
  ```javascript
  const resolvedBase = path.resolve(boveda);
  const safeTitulo = titulo.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  const rutaCarpeta = path.resolve(boveda, carpeta);
  if (!rutaCarpeta.startsWith(resolvedBase + path.sep) && rutaCarpeta !== resolvedBase) {
      return res.status(400).json({ error: 'Ruta no permitida fuera de la bóveda.' });
  }
  const rutaArchivo = path.join(rutaCarpeta, `${safeTitulo}.md`);
  ```

---

### [HIGH] `arturo-path-traversal-guardarboveda`
* **Ubicación:** `src/tools/langchainTools.js` (Líneas 65, 71, 90)
* **Actor de Menor Confianza:** Contexto LLM manipulado mediante Prompt Injection indirecto o instrucción conversacional.
* **Mecanismo:** `params.titulo` se sanea con regex, pero `params.carpeta_destino` se concatena directamente:
  ```javascript
  const destFolder = path.join(VAULT_PATH_BOVEDA, params.carpeta_destino);
  ```
  Permitiendo que secuencias `../../` escapen del directorio de la Bóveda hacia el disco del sistema.
* **Resultado:** Escritura de archivos arbitrarios `.md` fuera de la Bóveda por acción de herramientas del agente.
* **Solución Mínima Efectiva:**
  Validar contención con `path.resolve(destFolder).startsWith(path.resolve(VAULT_PATH_BOVEDA) + path.sep)` antes de crear carpetas o invocar `fs.writeFileSync`.

---

### [HIGH] `arturo-ipblocker-dysfunctional-bypass`
* **Ubicación:** `index.js` (Línea 46) y `src/middlewares/ipBlocker.js` (Líneas 58–66, 96, 119)
* **Actor de Menor Confianza:** Atacante en red local, Tailscale o internet realizando fuerza bruta o escaneo de archivos sensibles.
* **Mecanismo:**
  1. `index.js` envía `req.ip` (string).
  2. `isBlocked(req)` en `ipBlocker.js` asume que `req` es un objeto y consulta `(req.socket || req).remoteAddress`, lo que da `undefined`.
  3. Cae en el fallback `'127.0.0.1'`, que es evaluado inmediatamente por la lista blanca interna (`if (ip === '127.0.0.1') return false;`).
  4. La función retorna siempre `false` y nunca bloquea a nadie.
  5. Además, la función `accessesSensitivePath` invoca `console.warn` referenciando una variable no declarada `ip`, lo que causaría un `ReferenceError` si llegara a dispararse.
* **Resultado:** El mecanismo de bloqueo de IPs y rate limiting anti-escaneo es un falso control de seguridad sin efecto real.
* **Solución Mínima Efectiva:**
  Pasar `req` desde `index.js` (`ipBlocker.isBlocked(req)`), extraer la IP con `req.ip || req.socket?.remoteAddress`, pasar `ip` a `accessesSensitivePath(req, ip)` y corregir la marca de tiempo de la ventana en `exceedsLimit`.

---

### [MEDIUM] `arturo-cors-wildcard-fallback`
* **Ubicación:** `index.js` (Líneas 64–68)
* **Actor de Menor Confianza:** Sitio web de terceros cargado en el navegador del usuario.
* **Mecanismo:** La rama `else` del middleware CORS define `Access-Control-Allow-Origin: *` para cualquier origen no contemplado en `allowedOrigins`.
* **Resultado:** Permite a scripts web arbitrarios en el navegador de Ronald realizar lecturas cross-origin a la API de Arturo (ej. leyendo `/status` o aprovechando endpoints si la autenticación está desactivada).
* **Solución Mínima Efectiva:** Omitir el encabezado `Access-Control-Allow-Origin` cuando el origen no pertenezca a `allowedOrigins` y retornar `res.sendStatus(403)` en preflight `OPTIONS`.

---

### [MEDIUM] `arturo-status-unauthenticated-info-disclosure`
* **Ubicación:** `src/middlewares/authGuard.js` (Línea 15) y `src/controllers/status.js` (Líneas 18–25)
* **Actor de Menor Confianza:** Cualquier cliente de red sin autenticación.
* **Mecanismo:** `/status` está exento de `authGuard` pero `obtenerStatus` retorna la ruta absoluta del vault en disco (`VAULT_PATH`), el catálogo completo de modelos de IA locales y la configuración de integraciones.
* **Resultado:** Fuga de metadatos de infraestructura y sistema de archivos a actores no autorizados.
* **Solución Mínima Efectiva:** Reducir la respuesta del healthcheck a `{ servidor: "Arturo", estado: "operativo", uptime: ... }` y trasladar los diagnósticos detallados a un endpoint autenticado.

---

## 5. Tabla de Asuntos que Requieren Validación (Needs Validation)

| Identificador | Título | Ruta / Archivo | Bloqueador Decisivo | Plan de Validación |
|---|---|---|---|---|
| `arturo-docker-socket-proxy-container-escape` | Control Lateral de Contenedores vía Docker Socket Proxy | `docker-compose.yml:73` | Configuración de cortafuegos y políticas de red fuera del repositorio | Local: auditar si `docker-proxy` filtra rutas del daemon. Despliegue: restringir socket proxy solo a lectura o whitelist estricto de IDs de contenedores |

---

## 6. Patrones Positivos y Notas de Hardening
* **Thin Controllers y Zero-Logic:** Excelente separación de responsabilidades entre controladores HTTP (`src/controllers/`) y servicios de infraestructura (`src/services/`).
* **Consultas Parametrizadas:** Tanto `chatRepository.js` como `mediaRepository.js` y `gpuQueueService.js` utilizan sentencias preparadas de `better-sqlite3` con marcadores `?`, previniendo inyecciones SQL.
* **Headers de Seguridad HTTP:** `securityHeaders.js` aplica correctamente `nosniff`, `DENY` en frame options y `XSS-Protection`.
* **Desacoplamiento de GPU:** La cola SQLite en `gpuQueueService.js` maneja adecuadamente las prioridades y previene bloqueos de concurrencia en la VRAM de la RTX 5060 Ti.
* **Hardening sugerido:**
  * Implementar `crypto.timingSafeEqual` en `authGuard.js` para mitigar ataques de temporización en la validación de `X-Arturo-Key`.
  * Configurar autenticación mediante token de servicio para el script del host `scripts/sysadmin_guard.sh`.

---

## 7. Resumen de Cobertura del Ledger
* **Unidades en Ledger:** 13
* **Candidatos (Vulnerabilidades Confirmadas o Leads):** 6
* **Superficies Cubiertas (Sin Hallazgos Críticos):** 7
* **Unidades Diferidas / Bloqueadas:** 0
* **Veredicto de Esquemas:** PASS (100% conforme con las especificaciones de `report-schema.json`).

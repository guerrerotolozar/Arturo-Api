# Arquitectura de Seguridad — Docker e Infraestructura de Arturo

## 1. Visión General del Sistema
El entorno de Arturo (`Z:\`) orquesta múltiples microservicios contenerizados y nativos sobre una máquina Linux host dedicada (accesible mediante Tailscale y red local):
* **Nivel 1 (Orquestador Central):** `Arturo-Api` (`Z:\API`), expuesto en `127.0.0.1:3000`, montando la Bóveda de Obsidian (`./Cerebro`) en lectura y escritura, SQLite y LanceDB.
* **Nivel 2 (Microservicios de IA & STT):**
  - `Whisper-Service` (`Z:\WhisperService`): STT GPU acelerado bajo demanda (scale-to-zero) en `arturo-net:8080`.
  - `llama-server` (`Z:\HermesAgent`): Servidor LLM llama.cpp ejecutando `ornith-1.0-9b-Q8_0.gguf` con 99 capas en GPU.
* **Nivel 3 (Agentes Autónomos & Trading):** `Bot-Trading` (`Z:\BotTrading`), ejecutando estrategias algorítmicas con persistencia en SQLite y Bóveda.
* **Nivel 4 (Control de Daemon Docker):** `docker-proxy` (`tecnativa/docker-socket-proxy`), intermediando el socket Unix `/var/run/docker.sock` sobre TCP HTTP en el puerto 2375.
* **Nivel 5 (Respaldo Automatizado):** Script `backup_citadel.sh` (`Z:\scripts`), ejecutando snapshots cifrados con restic hacia Google Drive.

---

## 2. Diagrama de Topología de Red y Fronteras de Confianza

```
[ Internet / Cloudflare Tunnels ]
         │                  │
         ▼                  ▼
  [ FloresByDolly ]   [ OasisStore ] (W:\)
       (Aislada)            │ (oasis-paymenter / oasis-webhook)
                            ▼
═══════════════════════ arturo-net (Red Docker Compartida) ═══════════════════════
        │                           │                           │
        ▼                           ▼                           ▼
[ Arturo-Api:3000 ]         [ docker-proxy:2375 ]      [ Whisper-Service:8080 ]
        │                     (SOCKET DE DOCKER)
        │
═══════════════════════ docker-internal (Recomendado) ═════════════════════════════
```

---

## 3. Superficies de Ataque y Límites de Confianza

1. **Docker Socket HTTP API (`docker-proxy`):**
   - **Confianza:** El socket de Docker equivale a privilegios totales de `root` sobre el host anfitrión.
   - **Exposición:** Expuesto en `arturo-net` en `0.0.0.0:2375` (a nivel de red Docker), permitiendo a cualquier contenedor en `arturo-net` (como `oasis-paymenter`) emitir llamadas de creación de contenedores (`POST=1`).
2. **Exposición de Inferencia LLM (`HermesAgent/llama-server`):**
   - **Confianza:** Acceso no autenticado al hardware GPU (VRAM de 12GB).
   - **Exposición:** Mapeo `0.0.0.0:8080:8080` sin flags de API Key ni restricción de loopback.
3. **Integridad de Imagen Docker (`WhisperService/Dockerfile`):**
   - **Confianza:** Descarga de herramientas de compilación C++ y librerías CUDA.
   - **Exposición:** Bypasses de validación de certificados y llaves GPG (`--allow-unauthenticated`).
4. **Colisión de Puertos e Inmutabilidad de Código (`BotTrading`):**
   - **Confianza:** Enlace local `127.0.0.1:8085` (conflicto con `oasis-paymenter`) y montaje `.:/app` RW en caliente.
5. **Cadena de Respaldo y Recuperación ante Desastres (`backup_citadel.sh`):**
   - **Confianza:** Respaldo atómico de base de datos de producción (`flores-mongodb`).
   - **Exposición:** Invocación de `mongodump` sin autenticación descartando errores (`2>/dev/null || true`).

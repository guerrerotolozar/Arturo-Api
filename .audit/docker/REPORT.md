# Informe de Auditoría de Seguridad — Docker e Infraestructura de Arturo

## 1. Configuración de la Auditoría
* **Perfil:** `standard` (Full Audit Mode)
* **Objetivo:** Infraestructura Docker y Scripts de Entorno de Arturo (`Z:\`)
* **Referencia de Código:** `HEAD` (inspección de `Z:\docker-compose.yml`, `Z:\HermesAgent`, `Z:\WhisperService`, `Z:\BotTrading`, `Z:\scripts`)
* **Alcance:** Dockerfiles, compose files, socket proxies, network boundaries, volumenes y scripts de respaldo.
* **Política de Ejecución:** `sandboxed-source-and-local-only`
* **Verificación Independiente:** Candidatos analizados y corroborados por el subagente verificador independiente `verifier-indep` (`d0511ce5-1341-49d4-a3f0-d31364904744`).
* **Estado:** 5 hallazgos confirmados (1 CRITICAL, 4 HIGH).

---

## 2. Resumen Ejecutivo de la Postura de Seguridad

La arquitectura de microservicios contenerizados de Arturo cuenta con una excelente base de aislamiento en la API principal (ejecución no root `1000:1000`, puertos enlazados a `127.0.0.1` y desacoplamiento de la GPU). Sin embargo, se identificaron **cinco vulnerabilidades graves de infraestructura**:

1. **Escape de Contenedor y Compromiso Total del Servidor (CRITICAL):**
   `docker-proxy` (`tecnativa/docker-socket-proxy`) monta `/var/run/docker.sock` con `POST=1` y `privileged: true` expuesto en la red compartida `arturo-net`. Al estar compartida con `oasis-paymenter` (aplicación web PHP de e-commerce), un compromiso en la tienda web permite al atacante ordenar a Docker crear un contenedor con `/` montado del host, alcanzando privilegios de root absolutos sobre la máquina anfitriona.
2. **Exposición No Autenticada del Modelo LLM 9B en 0.0.0.0 (HIGH):**
   `llama-server` (`HermesAgent`) mapea `0.0.0.0:8080:8080` sin flag `--api-key`, permitiendo a cualquier actor de red (LAN/Tailscale/WAN) agotar la VRAM de la GPU y explotar la API de inferencia.
3. **Omisión de Integridad Criptográfica en Imagen Whisper (HIGH):**
   `WhisperService/Dockerfile` deshabilita la verificación GPG con `--allow-unauthenticated` y `--allow-insecure-repositories`, exponiendo la imagen a envenenamiento de paquetes.
4. **Colisión de Puertos e Inmutabilidad Rota en BotTrading (HIGH):**
   `BotTrading` enlaza `127.0.0.1:8085` (provocando error `port already allocated` con `OasisStore`) y monta `.:/app` en caliente, arriesgando la integridad de archivos de código y `.env` en el host.
5. **Falla Silenciosa de Respaldos de Producción en Citadel (HIGH):**
   `backup_citadel.sh` ejecuta `mongodump` sin autenticación descartando errores con `2>/dev/null || true`. Con la reciente activación de `mongod --auth`, el respaldo genera archivos de 0 bytes, engañando al administrador con un falso reporte de éxito mientras la base de datos no tiene copias de seguridad.

---

## 3. Matriz de Hallazgos Confirmados

| Severidad | Identificador | Título | Límite Afectado | Resultado Observable |
|---|---|---|---|---|
| **CRITICAL** | `arturo-docker-socket-proxy-blast-radius` | Socket Proxy en Red Compartida multi-tenant | Aislamiento Contenedor-Host | Compromiso root del host desde contenedores web |
| **HIGH** | `arturo-docker-hermes-llama-unauthenticated-exposure` | Llama-Server 9B expuesto en 0.0.0.0 sin Auth | Perímetro de Red del Host | DoS de GPU VRAM y uso no autorizado de IA |
| **HIGH** | `arturo-docker-whisper-insecure-apt-supply-chain` | Desactivación de verificación GPG en APT | Integridad de Paquetes / Build | Código malicioso en build de contenedor Whisper |
| **HIGH** | `arturo-docker-bot-port-collision-and-source-mount` | Conflicto de Puerto 8085 y Montaje `.:/app` | Disponibilidad Operativa | Caída de servicio en arranque y mutabilidad de host |
| **HIGH** | `arturo-docker-backup-mongodump-auth-failure` | Falla Silenciosa de `mongodump` con Auth | Resiliencia ante Desastres | Respaldos de 0 bytes en Google Drive con falso OK |

---

## 4. Próximos Pasos Recomendados
1. Aplicar la segmentación de red en `Z:\docker-compose.yml` aislando `docker-proxy` en una red interna `docker-mgmt-net` donde solo viva `Arturo-Api`.
2. Restringir `HermesAgent` a `127.0.0.1:8080:8080` y añadir API key.
3. Limpiar las directivas inseguras de `WhisperService/Dockerfile`.
4. Reasignar el puerto de `BotTrading` a `8086` y remover el montaje `.:/app`.
5. Actualizar `backup_citadel.sh` con credenciales de MongoDB y validación `[ -s archive ]`.

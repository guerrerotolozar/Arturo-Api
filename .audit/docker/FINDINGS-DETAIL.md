# Detalle Técnico de Hallazgos — Docker Arturo

### [CRITICAL] `arturo-docker-socket-proxy-blast-radius`
* **Ubicación:** `Z:\docker-compose.yml` (Líneas 73–87) y `W:\OasisStore\docker-compose.yml` (Líneas 107–108, 167–170).
* **Actor de Menor Confianza:** Proceso o atacante dentro de cualquier contenedor web conectado a `arturo-net` (ej. `oasis-paymenter`).
* **Mecanismo:** El demonio de Docker `/var/run/docker.sock` está expuesto vía `tecnativa/docker-socket-proxy` en el puerto TCP 2375 dentro de `arturo-net`. Con las variables `CONTAINERS=1` y `POST=1`, cualquier cliente en la red puede ejecutar:
  ```bash
  curl -X POST http://docker-proxy:2375/v1.41/containers/create \
    -H "Content-Type: application/json" \
    -d '{"Image":"alpine","Cmd":["sh","-c","chroot /host /bin/bash"],"HostConfig":{"Binds":["/:/host"],"Privileged":true}}'
  ```
* **Resultado:** Escalada inmediata de privilegios a `root` sobre el host físico/Linux.
* **Solución Mínima Efectiva:**
  Crear una red interna `docker-mgmt-net` de tipo `internal: true`. Mover `docker-proxy` para que solo esté conectado a esa red. Conectar `Arturo-Api` a `docker-mgmt-net` y a `arturo-net`. Remover `docker-proxy` de `arturo-net`.

---

### [HIGH] `arturo-docker-hermes-llama-unauthenticated-exposure`
* **Ubicación:** `Z:\HermesAgent\docker-compose.yml` (Líneas 6–10).
* **Actor de Menor Confianza:** Dispositivo en la red LAN, Tailscale o atacante con acceso a la IP del servidor.
* **Mecanismo:** La directiva `ports: - "8080:8080"` no especifica IP de loopback. `llama-server` escucha en todas las interfaces de red sin requerir clave de API.
* **Resultado:** Agotamiento de la GPU (modelo 9B en context window 128k), denegación de servicio para el resto de sistemas y uso no autorizado del modelo.
* **Solución Mínima Efectiva:**
  ```yaml
  ports:
    - "127.0.0.1:8080:8080"
  command: -m /models/ornith-1.0-9b-Q8_0.gguf --api-key "${HERMES_API_KEY}" -c 131072 --host 0.0.0.0 --port 8080 --n-gpu-layers 99
  ```

---

### [HIGH] `arturo-docker-whisper-insecure-apt-supply-chain`
* **Ubicación:** `Z:\WhisperService\Dockerfile` (Líneas 11–13, 40–42).
* **Actor de Menor Confianza:** Espejo APT comprometido o atacante en red local (MitM).
* **Mecanismo:** Inyección de `Acquire::Check-Valid-Until "false"` y parámetros `--allow-unauthenticated` y `--allow-insecure-repositories` en `apt-get install`.
* **Resultado:** Instalación de dependencias de build y runtime sin validar firmas criptográficas GPG.
* **Solución Mínima Efectiva:**
  Remover el script de bypass y las banderas `--allow-*`.

---

### [HIGH] `arturo-docker-bot-port-collision-and-source-mount`
* **Ubicación:** `Z:\BotTrading\docker-compose.yml` (Líneas 8–9, 23–26).
* **Actor de Menor Confianza:** Proceso local o colisión de servicios.
* **Mecanismo:** `127.0.0.1:8085:8085` genera un conflicto de puerto con `oasis-paymenter` (puerto 8085). El montaje `.:/app` rompe la inmutabilidad de la imagen construida.
* **Resultado:** Fallo de arranque de contenedores (`port is already allocated`) y riesgo de corrupción de código host.
* **Solución Mínima Efectiva:**
  Mapear a `127.0.0.1:8086:8085` y remover el bind mount `.:/app`.

---

### [HIGH] `arturo-docker-backup-mongodump-auth-failure`
* **Ubicación:** `Z:\scripts\backup_citadel.sh` (Línea 48).
* **Actor de Menor Confianza:** Escenario de desastre o pérdida de datos.
* **Mecanismo:** `docker exec flores-mongodb mongodump --archive > "$TEMP_DIR/flores_mongodb.archive" 2>/dev/null || true` falla silenciosamente tras exigir `mongod --auth`.
* **Resultado:** Generación de un archivo de 0 bytes respaldado en Google Drive con falso reporte de éxito.
* **Solución Mínima Efectiva:**
  ```bash
  docker exec flores-mongodb sh -c 'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive' > "$TEMP_DIR/flores_mongodb.archive"
  if [ ! -s "$TEMP_DIR/flores_mongodb.archive" ]; then
      echo "❌ Error crítico: El volcado de flores-mongodb falló o está vacío."
      exit 1
  fi
  ```

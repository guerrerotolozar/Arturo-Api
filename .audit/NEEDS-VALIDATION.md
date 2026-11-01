# Asuntos que Requieren Validación — Arturo API

Este documento contiene los candidatos a vulnerabilidades identificados en el código estático que no pueden ser confirmados con certeza absoluta sin datos del entorno de despliegue, configuración de red en vivo o directrices operativas del propietario.

---

## 1. Control Lateral de Contenedores y Privilegios en Docker Socket Proxy
* **Identificador:** `arturo-docker-socket-proxy-container-escape`
* **Límite Afectado:** Aislamiento entre contenedores dentro de la red Docker (`arturo-net`).

### Traza y Evidencia en Repositorio
* `docker-compose.yml:73-87`:
  ```yaml
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: docker-proxy
    privileged: true
    environment:
      - CONTAINERS=1
      - EVENTS=1
      - IMAGES=1
      - POST=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - arturo-net
  ```
* `src/adapters/whisperAdapter.js:13`:
  El contenedor `Arturo-Api` se comunica con `http://docker-proxy:2375/v1.41/containers/Whisper-Service/start` para levantar Whisper on-demand.
* `src/services/wolfWatcherService.js:44`:
  El servicio de vigilancia de juegos envía peticiones de terminación: `POST http://docker-proxy:2375/v1.41/containers/${id}/kill`.

### Bloqueadores Decisivos
1. **Intencionalidad de diseño:** Arturo API actúa como orquestador y supervisor de la Torre; el acceso para matar esclavos de Wolf y levantar Whisper fue diseñado de manera deliberada.
2. **Alcance de red en host:** No es visible en el código del repositorio si `docker-proxy:2375` está expuesto a interfaces externas del host o confinado exclusivamente a la red puente interna `arturo-net`.
3. **Ausencia de filtrado por contenedor:** Al habilitar `POST=1` y `CONTAINERS=1` a nivel global en la variable de entorno del proxy, cualquier proceso que comprometa `Arturo-Api` puede enviar peticiones arbitrarias al daemon de Docker para detener, iniciar o manipular otros contenedores conectados a la misma red.

### Planes de Validación
* **Plan de Validación Local:**
  Inspeccionar en la máquina anfitriona (`Ubuntu Server`) si `docker-proxy` tiene puertos vinculados al host (`docker ps`) o si está estrictamente en la red interna:
  ```bash
  docker inspect docker-proxy --format '{{json .NetworkSettings.Ports}}'
  ```
* **Plan de Validación en Despliegue (Para el Propietario):**
  1. Verificar si es posible limitar el proxy a endpoints específicos en lugar de habilitar `POST=1` para toda la API de contenedores.
  2. Implementar un proxy con reglas de autorización basadas en nombres de contenedores permitidos (`Whisper-Service` y contenedores con prefijo `wolf-`), impidiendo la manipulación de contenedores de bases de datos (`flores-mongodb`, `PayVerifier-DB`).

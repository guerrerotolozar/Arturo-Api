# 🧠 Arturo — Sistema de Inteligencia Personal

> **Segundo Cerebro de Ronald** — Tu asistente de IA impulsado por LangChain, LanceDB y Ollama (Ornith-Vision 9B) para gestión de información, análisis multimedia, síntesis de voz y orquestación.

---

## 📦 Estructura del Proyecto

```
~/ARTURO/
├── docker-compose.yml          # Orquestador principal (API + Whisper + Bot Trading)
├── WhisperService/             # Contenedor dedicado con GPU para transcripciones
├── API/                        # Arturo API (Node.js 20) — El cerebro principal
│   ├── Dockerfile
│   ├── .env
│   ├── .env.example           # Variables de entorno (DOCUMENTACIÓN)
│   ├── package.json
│   ├── index.js               # Punto de entrada Express
│   ├── database/              # SQLite (memoria conversacional e historial multimedia)
│   ├── lancedb_data/          # Base de datos vectorial persistente (Embedded LanceDB)
│   ├── scripts/               # Scripts manuales de administración
│   └── src/
│       ├── adapters/          # Conectores externos (Ollama, Whisper, Piper, Tavily, Video)
│       ├── config/            # Variables de entorno
│       ├── controllers/       # Controladores HTTP (Express)
│       ├── middlewares/       # Guards y autenticación (v10)
│       ├── repositories/      # DAOs (SQLite, LanceDB, FileSystem)
│       ├── services/          # Lógica de dominio y agentes asíncronos
│       ├── tools/             # Herramientas OCP de LangChain
│       ├── use-cases/         # Flujos principales (LangChain Agent)
│       └── utils/             # Utilidades varias
├── BotTrading/                 # Bot de Trading subordinado (Python)
├── Cerebro/                    # Segundo Cerebro (Obsidian)
│   └── Boveda/                 # La bóveda — fuente de verdad
│       ├── Media/             # Videos/imágenes procesados e indexados
│       └── [notas .md]/       # Vault Zettelkasten
└── README.md
```

---

## 🚀 Prerequisitos y Arranque

### Arranque del Ecosistema

```bash
# Todo el sistema (API + Whisper + Bot)
cd ~/ARTURO
docker compose up -d

# Rebuild limpio sin caché de imágenes y purgando basura temporal
alias dbuild='docker compose up -d --build && docker image prune -f && docker builder prune -f'
dbuild
```

---

## 📱 Endpoints Principales (API)

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| `POST` | `/api/agent/chat` | Agente Principal (LangChain + Ornith-Vision 9B + Tool Calling) |
| `POST` | `/api/media/download` | Descarga directa de media (YouTube, Instagram, TikTok, etc.) |
| `POST` | `/api/notas` | Crear notas estructuradas en el Vault |
| `GET` | `/api/chats` | Lista de conversaciones |
| `GET` | `/api/chats/:id/mensajes` | Lista de mensajes de un chat específico |
| `DELETE` | `/api/chats/:id` | Eliminar una conversación |
| `GET` | `/status` | Health check general del ecosistema |
| `POST` | `/api/vectores/sync` | Forzar Sincronización Bóveda → LanceDB |
| `GET` | `/api/vectores/estado` | Estado de la base vectorial LanceDB |
| `POST` | `/api/notifications` | Encolar notificación push |
| `GET` | `/api/notifications/stream` | SSE de notificaciones en tiempo real (Push para Android) |
| `GET` | `/api/media` | Lista de multimedia descargada (filtrable) |
| `GET` | `/api/media/pending` | Conteo de elementos multimedia pendientes de procesar |
| `GET` | `/api/media/:id` | Detalle y metadatos de un ítem multimedia |

---

## 📊 Resumen de Servicios

| Servicio | Container | Puerto | Tecnología |
| -------- | --------- | ------ | ---------- |
| Arturo API | `Arturo-Api` | 3000 | Node.js 20 |
| Whisper | `Whisper-Service` | 8080 | C++ (CUDA) |
| Bot Trading | `Bot-Trading` | 8085 | Python 3.12 |
| Ollama | _(nativo)_ | 11434 | Go |
| Syncthing | _(nativo)_ | 8384 | Go |

---

## 🛡️ Seguridad (v10)

### Protección Implementada

- **Rate Limiting**: Límites por tipo de petición (normal, agent, sync, notifications)
- **IP Blocking**: Bloqueo automático de IPs maliciosas (scanning, brute force)
- **CORS Restringido**: Solo localhost y Tailscale (fallback desarrollo)
- **Headers de Seguridad**: X-Content-Type-Options, X-Frame-Options, CSP, etc.
- **Logging Mejorado**: Timestamp, requestId, IP, Agent, Duration, Status
- **Autenticación**: API Keys por dispositivo (Mobile + Desktop)
- **Body Parser**: Límite de 10MB (reducido de 50MB)

### Auditoría de Seguridad Independiente (Full Audit Mode)

En la versión v10 se ejecutó una auditoría de seguridad exhaustiva utilizando la skill especializada `security-audit` de Google Antigravity en modo **Full Audit**. El análisis cubrió 13 superficies de ataque (HTTP, controladores, middlewares, adaptadores de IA, base vectorial y docker-proxy), validando de forma estricta los límites de confianza y sumideros de ejecución mediante subagentes verificadores independientes.

Los resultados y artefactos formales se encuentran registrados en el directorio [`.audit/`](./.audit/):
- **[`REPORT.md`](./.audit/REPORT.md)**: Informe ejecutivo de seguridad, desglose de postura y tablas de hallazgos.
- **[`FINDINGS-DETAIL.md`](./.audit/FINDINGS-DETAIL.md)**: Trazas fuente a sumidero, reproducciones delimitadas y casos de prueba de regresión.
- **[`NEEDS-VALIDATION.md`](./.audit/NEEDS-VALIDATION.md)**: Aspectos sujetos a validación de topología de red (`docker-proxy`).
- **[`findings.json`](./.audit/findings.json)**: Registros estructurados validados contra el esquema JSON oficial (`report-schema.json`).
- **[`coverage-ledger.json`](./.audit/coverage-ledger.json)**: Matriz determinista de cobertura de superficies analizadas.

#### Hallazgos Clave Identificados para Remediación:
1. **[HIGH] Path Traversal en `POST /api/notas` (`src/controllers/nota.js`)**: Concatena `carpeta` y `titulo` sin validar contención en el Vault, permitiendo escribir o anexar archivos `.md` en rutas arbitrarias del host.
2. **[HIGH] Path Traversal en Tool `guardar_boveda` (`src/tools/langchainTools.js`)**: Concatena `params.carpeta_destino` sin saneamiento en `path.join()`.
3. **[HIGH] Evasión Silenciosa de `ipBlocker` (`index.js` y `src/middlewares/ipBlocker.js`)**: Desajuste en el paso de parámetros (`req.ip` en lugar de `req`) provoca que todas las IPs externas colapsen a `'127.0.0.1'`, quedando en whitelist perpetua sin bloquear jamás.
4. **[MEDIUM] Wildcard CORS Permisivo (`index.js`)**: Emisión de encabezado `Access-Control-Allow-Origin: *` como fallback para orígenes externos no contemplados.
5. **[MEDIUM] Divulgación de Información en `/status` (`src/controllers/status.js`)**: Exposición no autenticada de la ruta física del vault (`VAULT_PATH`) y del inventario de modelos de Ollama.

### Variables de Entorno

Ver [.env.example](./src/.env.example) para documentación completa.

---

## 🏗️ Arquitectura del Agente

### Flujo de Petición al Agente (LangChain Pipeline)

```text
┌──────────────────────────────────────────────────────────────────┐
│                      /api/agent/chat                             │
│                                                                  │
│  1. Controlador (agent.js) — Thin Controller                     │
│     ├─ Valida payload (pregunta, imagen, video, media_id)         │
│     ├─ Check GPU Status (gpuMonitorService)                       │
│     └─ Si GPU libre: delega a agentCoreService                    │
│     └─ Si GPU ocupada: encola en GPU Queue                        │
│                                                                  │
│  2. agentCoreService (Lógica Central)                             │
│     ├─ Enriquece prompt con video (visual + transcripción)        │
│     ├─ Busca notas Markdown pre-generadas del video               │
│     ├─ Recupera historial de chat (chatRepository)                │
│     └─ Invoca LangChain AgentExecutor                             │
│                                                                  │
│  3. LangChain Agent (langchainAgent.js)                           │
│     ├─ ChatOllama (Ornith-Vision 9B) con bindTools                │
│     ├─ RAG pasivo: busca en LanceDB (top 2 chunks relevantes)     │
│     ├─ ¿Requiere herramientas?                                    │
│     │    ├─ SÍ → Ejecuta tools recursivamente (buscar_internet,   │
│     │    │    consultar_boveda, guardar_boveda, etc.)             │
│     │    └─ NO → Responde directamente                            │
│     └─ Streaming SSE                                              │
│                                                                  │
│  4. Persistencia (SQLite)                                        │
│     └─ Guarda iteraciones (Humano/AI) y actualiza título chat     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📦 Servicios del Proyecto (`src/services/`)

La lógica de negocio y automatizaciones asíncronas residen aquí:

- **`agentCoreService.js`** — Lógica central del Agente. Extraída de `agent.js` para mantener thin controllers. Procesa videos, imágenes, invoca LangChain y persiste en SQLite.
- **`vigilanteService.js`** — Curador Automático del Zettelkasten. Analiza la bandeja de entrada (Media), usa la IA para extraer conceptos puros atemporales y crea nuevas notas estructuradas en el Cerebro.
- **`mediaAnalysisService.js`** — Analizador Multimedia. Recibe un video, le extrae frames, obtiene la transcripción (vía Whisper), lo resume con Ornith y le inyecta **Conexiones Cerebrales** consultando a LanceDB.
- **`mediaDownloaderService.js`** — Orquestador de descargas sociales (YouTube, IG, TikTok) usando yt-dlp y gallery-dl.
- **`cerebroWatcherService.js`** — Escucha eventos del FileSystem (Obsidian) para sincronizaciones en vivo.
- **`contextService.js`** — Inyecta conciencia de fecha, hora y entorno a los prompts.
- **`vaultService.js`** y **`ragService.js`** — Funciones de lectura de categorías y búsqueda de contexto para RAG.
- **`igScraper.py`** — Script auxiliar de Python para hacer bypass a las trabas de Instaloader y extraer comentarios.
- **`gpuWorkerService.js`** — Worker de la cola de GPU. Procesa peticiones encoladas cuando la GPU está libre.
- **`gpuMonitorService.js`** — Monitor de GPU en tiempo real con `nvidia-smi`.
- **`gpuQueueService.js`** — Cola de GPU con prioridades (1=agent, 2=bot, 3=vault_sync).
- **`pythonSandboxService.js`** — Ejecución de código Python seguro en sandbox.
- **`thumbnailService.js`** — Generación de thumbnails para videos/imágenes.
- **`mayordomoService.js`** — Orquestador de tareas domésticas del ecosistema.
- **`vaultIndexer.js`** — Motor de indexación que lee miles de notas Markdown, las fragmenta, genera embeddings en segundo plano y las guarda en LanceDB. (use-cases/)
- **`calculator.js`** — Motor aritmético y financiero.

---

## 📜 Scripts de Administración (`src/scripts/`)

- **`colorearGrafo.js`** — Visualización de grafos de relaciones entre notas.
- **`retro_media_linker.js`** — Script que escanea el historial antiguo de Media y le inyecta proactivamente "Conexiones Cerebrales" basadas en la base de datos vectorial.
- **`run_vigilante.js`** — Disparador manual para correr el servicio del Vigilante (Curaduría de conocimiento).

---

## 🔌 Adaptadores (`src/adapters/`)

Encapsulan la comunicación con APIS externas o modelos:

- **`ollamaAdapter.js`** — Conexión directa a Ollama (fuera del flujo de LangChain).
- **`whisperAdapter.js`** — Conector con `Whisper-Service` por HTTP para transcribir audios dinámicamente.
- **`tavilyAdapter.js`** — Conector para la API de búsqueda web de Tavily.
- **`videoAdapter.js`** — Extracción de frames y procesamiento visual.
- **`piperAdapter.js`** — Síntesis de voz (Text-to-Speech).

---

## 🧰 Repositorios (DAOs y Base de Datos) (`src/repositories/`)

- **`vectorRepository.js`** — Gestor de **LanceDB**. Permite búsquedas semánticas súper rápidas (`buscarSemanticamente`) comparando embeddings (Nomic) con tu bóveda de Obsidian.
- **`chatRepository.js`** — Operaciones CRUD en SQLite para la memoria conversacional.
- **`mediaRepository.js`** — Registro e historial de videos e imágenes procesados.
- **`vaultRepository.js`** — Interacciones de lectura/escritura directas al FileSystem (Obsidian).
- **`syncRepository.js`** — Gestor de estado de sincronización.

---

## 🔧 Herramientas del Agente (`src/tools/`)

Arturo utiliza **LangChain Tools** para extender sus capacidades en tiempo real. Están agrupadas en `langchainTools.js`:

1. **`buscar_internet`** — Busca información actualizada en la web usando Tavily.
2. **`consultar_boveda`** — Búsqueda semántica usando LanceDB para encontrar conocimientos pasados almacenados en el Zettelkasten.
3. **`guardar_boveda`** — Permite al agente crear proactivamente notas YAML estructuradas en el Cerebro.
4. **`calcular_finanzas`** — Calculadora de amortizaciones, ROI y matemáticas exactas (Delegada a `use-cases/calculator.js`).

---

## 📜 Scripts Manuales (`src/scripts/`)

- **`retro_media_linker.js`** — Script que escanea el historial antiguo de Media y le inyecta proactivamente "Conexiones Cerebrales" basadas en la base de datos vectorial.
- **`run_vigilante.js`** — Disparador manual para correr el servicio del Vigilante (Curaduría de conocimiento).

---

## 📦 Dependencias Core (`package.json`)

- `@langchain/ollama`, `@langchain/core`, `langchain` — Orquestación del Agente y Tools.
- `@lancedb/lancedb` — Base de datos vectorial empotrada.
- `better-sqlite3` — Base de datos relacional ultrarrápida.
- `express` — Servidor HTTP y enrutamiento.
- `multer` — Parsing de archivos (uploads).
- `sharp` — Procesamiento de imágenes.
- `ws` — WebSockets para notificaciones.
- `chokidar` — Watcher de FileSystem para Cerebro.
- `ytdlp-nodejs` — Descargador de media social.
- `zod` — Validación estricta de esquemas (JSON).
- `cli-progress` — Barras de progreso en consola.

---

## 📝 Utilidades (`src/utils/`)

- **`markdownSearcher.js`** — Utilidad de búsqueda rápida de archivos `.md` en directorios.

---

## 📂 Controladores (`src/controllers/`)

Delgados y concisos (Thin Controllers). Pasan la información del Body/Params directamente a los Casos de Uso.

- `agent.js` (Chat IA) — Thin controller, delega a `agentCoreService`
- `media.js` & `download.js` (Gestión Multimedia)
- `vectores.js` (Sincronización LanceDB)
- `chats.js` (Listado de chats)
- `status.js` (Health check)
- `nota.js` (Crear notas)
- `notificaciones.js` (Push notifications)
- `gpu.js` (GPU Queue control)
- `bot.js` (Bot Trading control)

---

## 🧠 Casos de Uso (`src/use-cases/`)

La verdadera lógica orquestada:

- **`langchainAgent.js`** — El cerebro pensante. Maneja el bucle de razonamiento de ReAct con LangChain + Ornith-Vision 9B.
- **`vaultIndexer.js`** — Motor de indexación que lee miles de notas Markdown, las fragmenta, genera embeddings en segundo plano y las guarda en LanceDB. (use-cases/)
- **`calculator.js`** — Motor aritmético y financiero. (use-cases/)

---

## 🧠 Modelo de IA

- **Ornith-Vision 9B** — Modelo visual+texto, ejecutado localmente en Ollama.
- **Qwen3-Embedding 0.6B** — Modelos de embeddings para LanceDB.
- **Deep Analysis** — Habilitado por defecto. Usa el modelo "Deep" cuando está disponible (requiere GPU con 12GB+ VRAM). Si no está disponible, usa el modelo Fast con prompt enriquecido.

---

## ⚙️ Configuración Avanzada

### GPU Queue

La API monitorea el uso de GPU en tiempo real. Cuando el uso supera el umbral (85% por defecto) o la VRAM se agota (12GB por defecto), las peticiones se encolan automáticamente:

- **Prioridad 1**: Agent chat (más importante)
- **Prioridad 2**: Bot trading
- **Prioridad 3**: Vault sync

### Variables Clave

| Variable | Valor Default | Descripción |
| -------- | ------------- | ----------- |
| `GPU_VRAM_THRESHOLD_MB` | 12000 | VRAM máxima antes de encolar |
| `GPU_UTIL_THRESHOLD_PCT` | 85 | Utilización máxima antes de encolar |
| `DEEP_ANALYSIS_ENABLED` | true | Habilitar análisis con modelo Deep |

---

## 🛡️ Auditorías de Seguridad Independientes (Full Audit Mode)

El ecosistema Arturo cuenta con un marco continuo de auditoría de seguridad integral ejecutado con la skill `security-audit`, aplicando verificación de doble ciego mediante subagentes independientes y esquemas estructurados de trazabilidad.

### 1. Auditoría de Código y Lógica de API (`.audit/`)
* **Alcance:** Controladores HTTP, LangChain Tools, Middlewares (`ipBlocker`, `authGuard`, CORS), Base Vectorial LanceDB y Bóveda.
* **Artefactos:** Registrados en `.audit/` (`findings.json`, `coverage-ledger.json`, `REPORT.md`, `FINDINGS-DETAIL.md`).
* **Vulnerabilidades Mitigadas:**
  - Path Traversal en `POST /api/notas` y tool `guardar_boveda` hacia fuera de la Bóveda (Resuelto).
  - Bypass funcional en middleware `ipBlocker` por discrepancia de interfaces en llamadas `req.ip` (Resuelto).
  - Wildcard `Access-Control-Allow-Origin: *` en fallback CORS (Resuelto).
  - Divulgación no autenticada de rutas y catálogo de modelos en `/status` (Resuelto).

### 2. Auditoría de Infraestructura Docker y Entorno (`.audit/docker/`)
* **Alcance:** `docker-compose.yml`, `WhisperService/Dockerfile`, `HermesAgent/docker-compose.yml`, `BotTrading/docker-compose.yml`, scripts de respaldo `backup_citadel.sh` y segmentación de redes puente.
* **Artefactos:** Registrados en `.audit/docker/` (`findings.json`, `coverage-ledger.json`, `REPORT.md`, `FINDINGS-DETAIL.md`).
* **Vectores Auditados:**
  - `arturo-docker-socket-proxy-blast-radius` (CRITICAL): Exposición de Docker Socket en `arturo-net` mitigable mediante red de gestión aislada `docker-mgmt-net`.
  - `arturo-docker-hermes-llama-unauthenticated-exposure` (HIGH): Restricción de puerto `8080` a `127.0.0.1` e inyección de API Key.
  - `arturo-docker-whisper-insecure-apt-supply-chain` (HIGH): Restauración de firmas criptográficas GPG en build de Whisper.
  - `arturo-docker-bot-port-collision-and-source-mount` (HIGH): Desacoplamiento de puerto `8085` a `8086` y eliminación de bind mount `.:/app`.
  - `arturo-docker-backup-mongodump-auth-failure` (HIGH): Autenticación administrativa en volcado de `flores-mongodb` y validación de integridad.

---

_Última actualización: Noviembre 2026 — Arturo V10.0 (Thin Controllers, GPU Queue Worker, Auditoría de Seguridad Integral, Ornith-Vision 9B)_

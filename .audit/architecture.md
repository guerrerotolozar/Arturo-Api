# Architecture Summary: Arturo API (v10)

## 1. Product, Principals, and Protected Resources
* **Product**: Arturo API is the core intelligence backend and personal "Second Brain" assistant of Ronald. It provides conversational AI agent workflows, retrieval-augmented generation (RAG) over an Obsidian Vault ("Cerebro"), multimedia download and indexing (yt-dlp, ffmpeg, Whisper, Instaloader), GPU inference queue management for local Ollama instances, trading bot inference gateways, and system maintenance telemetry.
* **Principals**:
  * *Unauthenticated Actor*: Any network peer able to reach the HTTP port (by default bound to `127.0.0.1:3000`, bridged over Tailscale/Docker networks). Intended authority: access only to unauthenticated health checks (`GET /status`).
  * *Authorized Device / Client*: Mobile client (`S24 Ultra`) or workstation (`Laptop Windows`) presenting a pre-shared API key via `X-Arturo-Key`. Authority: conversational chatting, media ingestion, note writing, vector synchronization, and trading notifications.
  * *Internal Sensors / Automation*: Local bash scripts (`sysadmin_guard.sh`) reporting package update and driver health status via internal HTTP POST endpoints (`/api/sysadmin/*`).
  * *Subordinate Containers*: Microservices like trading bots communicating over Docker network (`arturo-net`).
* **Protected Resources**:
  * Personal Obsidian Vault (`VAULT_PATH_BOVEDA` / `VAULT_PATH`): Markdown knowledge base containing sensitive financial, academic, and private notes.
  * Vector Database (`LanceDB` at `lancedb_data/arturo_boveda.lance`): Semantic embeddings and chunked content.
  * SQLite Stores (`arturo_memoria.db`, `gpu_queue.db`): Chat history, media index, and GPU scheduling queue.
  * System Integrity & Host Environment: Execution capabilities (Node.js runtime, Python scripts, ffmpeg/ffprobe, and Docker socket proxy).

## 2. Tech Stack and Deployment Models
* **Runtime & Frameworks**: Node.js 20, Express 5.2.1, CommonJS.
* **Storage & Vectors**: `@lancedb/lancedb` 0.27.2 (Apache Arrow/Lance vector engine), `better-sqlite3` 12.9.0 (WAL mode, SQLite), `chokidar` 3.6.0 (filesystem watcher).
* **AI & Orchestration**: `@langchain/ollama`, `@langchain/langgraph`, `@langchain/core`, `zod` 3.23.8, LangSmith tracing, native local Ollama on host (`host.docker.internal:11434`).
* **Media & Automation**: `ytdlp-nodejs`, `ffmpeg`, `gallery-dl`, `instaloader` (Python 3), `sharp`.
* **Deployment Model**: Containerized service (`Arturo-Api`) running as non-root user `1000:1000` via Docker Compose, attached to `arturo-net` and `payverifier-network`, with access to `docker-proxy` (`tecnativa/docker-socket-proxy:2375`).

## 3. Entry Surfaces and Source-to-Sink Paths
* **HTTP REST & Streaming Endpoints**:
  * Agent & Bot Gateway: `POST /api/agent/chat` -> `agentCoreService.js` -> Ollama / LangGraph / LangChain Tools.
  * Bot Inference: `POST /api/bot/inference` -> `gpuQueueService.js` -> `doOllamaInference` on Ollama.
  * Note Creation: `POST /api/notas` -> `crearNotaHandler` -> `path.join` -> `fs.appendFileSync`.
  * Media Management: `POST /api/media/download` -> `mediaDownloaderService.js` -> yt-dlp / gallery-dl / instaloader; `GET /api/media/:id/file` & `/thumb` -> `res.sendFile`; `POST /api/media/sync` -> disk traversal.
  * Vector RAG: `POST /api/vectores/sync` -> `vaultIndexer.js` -> recursive read of `VAULT_PATH_BOVEDA` -> LanceDB upsert; `GET /api/rag/context` -> vector search.
  * Notifications: `POST /api/notifications` & `GET /api/notifications/stream` -> in-memory `EventEmitter` SSE bus.
  * Sysadmin Sensor: `POST /api/sysadmin/*` (`pesada`, `barata`, `alerta-critica`, `accion`) -> prompt injection into Ollama & flag file creation.
  * System Health: `GET /status` -> unauthenticated system inspection.

## 4. Trust Boundaries and Controls
* **Perimeter Defense (`authGuard.js`)**: Enforces `X-Arturo-Key` header matching `ARTURO_API_KEY_MOBILE` or `ARTURO_API_KEY_DESKTOP`. Weaknesses: fails open if keys are unset; bypasses `/status`; non-constant-time equality; does not authenticate internal bash scripts.
* **Abuse & Scanning Defense (`ipBlocker.js`)**: Evaluates `isBlocked(req.ip)`. Flaw: expects request object, receives string, defaults IP to `127.0.0.1` whitelist and never blocks.
* **Volume Control (`rateLimiter.js`)**: In-memory map rate limiter categorizing routes (`agent`, `sync`, `notifications`, `normal`).
* **Origin Boundary (CORS in `index.js`)**: Restricts known origins `localhost:3000` and `5173`, but falls back to wildcard `Access-Control-Allow-Origin: *` for any other origin.
* **Filesystem Boundary**: Expected isolation to `VAULT_PATH_BOVEDA` and `MEDIA_PATH`.

## 5. Repository-Relative Starting Paths
* Entrypoint: `index.js`
* Security Middlewares: `src/middlewares/authGuard.js`, `src/middlewares/ipBlocker.js`, `src/middlewares/rateLimiter.js`, `src/middlewares/securityHeaders.js`
* Handlers: `src/controllers/nota.js`, `src/controllers/agent.js`, `src/controllers/media.js`, `src/controllers/sysadmin.js`, `src/controllers/status.js`, `src/controllers/bot.js`
* Services & Tools: `src/tools/langchainTools.js`, `src/services/mediaDownloaderService.js`, `src/use-cases/calculator.js`, `src/services/sysadminService.js`, `src/services/gpuQueueService.js`

## 6. Companion Selection Summary
* `WEB-PROTOCOL-AND-AUTH.md`: Required due to custom API key header authentication, SSE streaming endpoints, wildcard CORS fallback, and HTTP reverse proxy boundaries.
* `DATA-ISOLATION-AND-LIFECYCLE.md`: Required due to filesystem storage of notes in Obsidian vault, arbitrary note appending, SQLite database stores, and media file lifecycle management.
* `AI-AND-LLM.md`: Required due to LangChain/LangGraph agent tool execution, prompt construction with untrusted package metadata, and Ollama model dispatching.
* `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md`: Required due to in-memory rate limiting, GPU scheduling queue, and 10MB JSON body parser regex replace routines.

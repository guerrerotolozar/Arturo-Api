# ============================================
# Arturo API — Dockerfile (Multi-Stage Build)
# ============================================

# --------------------------------------------
# Etapa 1: BUILDER
# Propósito: Instalar dependencias pesadas, compilar binarios C++
# y preparar los node_modules limpios.
# --------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Instalar python y compiladores C++ (necesarios para SQLite y LanceDB)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copiar manifiestos
COPY package*.json ./

# Instalar dependencias de producción (usamos install porque el lockfile no está sincronizado)
RUN npm install --omit=dev

# Forzar descarga de yt-dlp usando los módulos recién instalados
RUN rm -rf node_modules/ytdlp-nodejs/bin && node node_modules/ytdlp-nodejs/dist/scripts/downloadYtdlp.js

# --------------------------------------------
# Etapa 2: RUNNER (Producción)
# Propósito: Imagen ultra ligera solo con lo necesario para correr
# --------------------------------------------
FROM node:20-slim

WORKDIR /app

# Instalar SOLO utilidades de tiempo de ejecución (nada de compiladores)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Instalar Instaloader de Python de forma global
RUN pip3 install instaloader --break-system-packages \
    && rm -rf /root/.cache/pip

# Copiar los node_modules ya compilados desde la Etapa 1
COPY --from=builder /app/node_modules ./node_modules

# Copiar el código fuente (respetando .dockerignore)
COPY . .

# Asegurar propiedad para el usuario node
RUN chown -R 1000:1000 /app

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/status', r => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Ejecutar servidor
CMD ["node", "index.js"]

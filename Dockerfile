# ============================================
# Arturo API — Dockerfile
# El cerebro principal de Arturo (Node.js)
# ============================================
FROM node:20-slim

WORKDIR /app

# Instalar dependencias del sistema para sharp (procesamiento de imágenes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copiar package.json primero (cache de capas Docker)
COPY package.json ./

# Instalar dependencias
RUN npm install --production

# Copiar el resto del código
COPY . .

# Puerto de la API
EXPOSE 3000

# Healthcheck: verificar que la API responde
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/status', r => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Arrancar la API directamente (sin PM2)
CMD ["node", "index.js"]

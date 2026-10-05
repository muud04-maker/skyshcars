# Sky Cars WhatsApp Group Reader (read-only bridge) for a Linux VPS.
FROM node:20-bookworm-slim
# System Chromium + fonts for whatsapp-web.js (puppeteer). Puppeteer's own browser download is skipped.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
# Saved WhatsApp login lives here; docker-compose mounts it as a volume so it survives restarts and updates.
VOLUME ["/app/.wwebjs_auth"]
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]

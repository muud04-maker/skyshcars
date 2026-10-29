# Sky Cars WhatsApp Group Reader (read-only bridge) for a Linux VPS.
FROM node:22-bookworm-slim
# System Chromium + fonts for whatsapp-web.js (puppeteer). Puppeteer's own browser download is skipped.
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    STATE_DIR=/var/lib/skycars-group-reader
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
RUN groupadd --system skycars-reader \
    && useradd --system --gid skycars-reader --home-dir /nonexistent --shell /usr/sbin/nologin skycars-reader \
    && install -d -o skycars-reader -g skycars-reader -m 0700 /var/lib/skycars-group-reader
USER skycars-reader
# The supervisor must mount this directory on persistent storage.
VOLUME ["/var/lib/skycars-group-reader"]
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server.js"]

# ── Stage 1: build the Vite frontend ────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm install --no-audit --no-fund --loglevel=error

COPY . .
RUN npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:22-alpine

# nmap is required for network scanning; tcpdump for passive ARP gateway detection
# curl is required for interface-bound speed tests (VPN/direct comparison)
# Ookla speedtest CLI: downloaded directly as a static ARM64 binary (Alpine has no apt/deb)
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && apk add --no-cache nmap nmap-scripts tcpdump curl traceroute mtr \
 && ARCH="$(uname -m)" \
 && case "$ARCH" in \
      aarch64) ST_ARCH="aarch64" ;; \
      armv7l)  ST_ARCH="armhf"   ;; \
      x86_64)  ST_ARCH="x86_64"  ;; \
      *)        echo "[docker] Ookla speedtest: unsupported arch $ARCH, skipping"; exit 0 ;; \
    esac \
 && curl -fsSL "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-${ST_ARCH}.tgz" -o /tmp/st.tgz \
 && tar -xzf /tmp/st.tgz -C /usr/local/bin speedtest \
 && chmod +x /usr/local/bin/speedtest \
 && rm /tmp/st.tgz \
 && speedtest --accept-license --accept-gdpr --version 2>&1 || echo '[docker] speedtest binary installed'

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm ci --omit=dev --no-audit --no-fund --loglevel=error

# Copy server source and built frontend
# ARG CACHEBUST forces cache invalidation on every build so Docker
# never reuses a stale COPY layer from a previous build.
ARG CACHEBUST=1
COPY server/ ./server/
COPY --from=builder /app/dist ./dist/

# Persistent data directory (mount a volume here)
RUN mkdir -p /app/data

EXPOSE 7654

ENV NODE_ENV=production

CMD ["node", "server/index.js"]

# ── Stage 1: build the Vite frontend ────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm install --no-audit --no-fund

COPY . .
RUN npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:22-alpine

# nmap is required for network scanning; tcpdump for passive ARP gateway detection
# curl is required for interface-bound speed tests (VPN/direct comparison)
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && apk add --no-cache nmap nmap-scripts tcpdump curl traceroute mtr

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm ci --omit=dev

# Copy server source and built frontend
# ARG CACHEBUST forces cache invalidation on every build so the
# legacy Docker builder never reuses a stale COPY --from=builder layer.
ARG CACHEBUST=1
COPY server/ ./server/
COPY --from=builder /app/dist ./dist/

# Persistent data directory (mount a volume here)
RUN mkdir -p /app/data

EXPOSE 7654

ENV NODE_ENV=production

CMD ["node", "server/index.js"]

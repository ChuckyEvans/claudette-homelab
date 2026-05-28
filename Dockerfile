# ── Stage 1: build the Vite frontend ────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine

# nmap is required for network scanning; tcpdump for passive ARP gateway detection
RUN apk add --no-cache nmap nmap-scripts tcpdump

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source and built frontend
COPY server/ ./server/
COPY --from=builder /app/dist ./dist/

# Persistent data directory (mount a volume here)
RUN mkdir -p /app/data

EXPOSE 7654

ENV NODE_ENV=production

CMD ["node", "server/index.js"]

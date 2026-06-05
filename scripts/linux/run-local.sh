#!/usr/bin/env bash
# scripts/linux/run-local.sh
# Run Claudette natively on Linux or macOS — no Docker required.
# Network scanning works in full on Linux because nmap runs directly on the
# host NIC. On macOS, raw-socket scanning requires nmap + Npcap (or root).
#
# Requirements:
#   Node.js 22+   https://nodejs.org  (or via nvm / Homebrew)
#   nmap          sudo apt install nmap  |  brew install nmap
#
# Usage (from repo root):
#   ./scripts/linux/run-local.sh            # hot-reload dev server
#   ./scripts/linux/run-local.sh --prod     # build + run production server
#   ./scripts/linux/run-local.sh --stop     # stop a running background server
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

# ── Colour helpers ────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; GRAY='\033[0;90m'; RESET='\033[0m'
info()  { echo -e "${CYAN}$*${RESET}"; }
ok()    { echo -e "${GREEN}$*${RESET}"; }
warn()  { echo -e "${YELLOW}$*${RESET}"; }
err()   { echo -e "${RED}$*${RESET}" >&2; }

# ── Argument parsing ──────────────────────────────────────────────────────────
MODE="dev"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prod)   MODE="prod"; shift ;;
        --stop)   MODE="stop"; shift ;;
        *) err "Unknown argument: $1"; echo "Usage: $0 [--prod|--stop]" >&2; exit 1 ;;
    esac
done

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "$MODE" == "stop" ]]; then
    PIDS=$(pgrep -f "node server/index.js\|vite\|scripts/linux/run-local" 2>/dev/null || true)
    if [[ -n "$PIDS" ]]; then
        # shellcheck disable=SC2086
        kill $PIDS 2>/dev/null || true
        ok "Stopped Claudette processes."
    else
        echo -e "${GRAY}No running Claudette process found.${RESET}"
    fi
    exit 0
fi

OS_TYPE="$(uname -s)"
echo ""
info "Running Claudette locally (${OS_TYPE} / Node.js)"
echo "─────────────────────────────────────────────"

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
echo ""
info "[1/4] Checking Node.js..."
if ! command -v node &>/dev/null; then
    err "  ERROR: Node.js not found."
    err "         Install v22+ from https://nodejs.org or via nvm / Homebrew."
    exit 1
fi
NODE_VER="$(node --version)"
ok "  OK  ${NODE_VER}"

# ── 2. Check nmap ─────────────────────────────────────────────────────────────
echo ""
info "[2/4] Checking nmap..."
if command -v nmap &>/dev/null; then
    NMAP_VER="$(nmap --version 2>/dev/null | head -1)"
    ok "  OK  ${NMAP_VER}"
else
    warn "  WARN: nmap not found — network scanning will be unavailable."
    if [[ "$OS_TYPE" == "Darwin" ]]; then
        warn "        Install with Homebrew:  brew install nmap"
    else
        warn "        Install with apt:       sudo apt install nmap"
    fi
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
echo ""
info "[3/4] Installing dependencies..."
if [[ -d node_modules ]]; then
    npm install --prefer-offline --no-audit --no-fund --loglevel=error
else
    npm install --no-audit --no-fund --loglevel=error
fi
ok "  OK"

# ── 4. Config ─────────────────────────────────────────────────────────────────
if [[ ! -f config.yaml ]]; then
    cp config.example.yaml config.yaml
    warn ""
    warn "  Created config.yaml from template."
    warn "  Edit it before using (subnet, services, ISP details)."
fi

# ── 5. Start ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$MODE" == "prod" ]]; then
    info "[4/4] Building and starting production server..."
    npm run build
    echo ""
    ok "  Open http://localhost:7654"
    echo ""
    NODE_ENV=production node server/index.js
else
    info "[4/4] Starting dev server (hot-reload)..."
    echo ""
    ok "  UI  → http://localhost:5173  (hot-reload)"
    echo -e "${GRAY}  API → http://localhost:7654${RESET}"
    echo ""
    npm run dev
fi

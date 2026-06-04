#!/usr/bin/env bash
# scripts/linux/deploy-pi.sh
# Deploy Claudette to the Raspberry Pi.
# Forwards all arguments to scripts/deploy-pi.mjs (Node.js, cross-platform).
#
# Requirements: Node.js 22+, OpenSSH client, scp
#
# Usage (from repo root):
#   ./scripts/linux/deploy-pi.sh                        # full deploy
#   ./scripts/linux/deploy-pi.sh --quick                # sync server/ only (~5 s)
#   ./scripts/linux/deploy-pi.sh --pre-built            # ship local dist/, skip npm build on Pi
#   ./scripts/linux/deploy-pi.sh --skip-build           # reuse existing image on Pi
#   ./scripts/linux/deploy-pi.sh --pi-host 192.168.1.5  # override Pi host
#
# Or use npm: npm run deploy [-- --quick|--pre-built|--skip-build]
#
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
exec node "$PROJECT_DIR/scripts/deploy-pi.mjs" "$@"

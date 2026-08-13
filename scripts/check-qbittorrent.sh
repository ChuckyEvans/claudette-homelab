#!/usr/bin/env bash
# Quick health-check for qBittorrent (local + remote via SSH)
# Usage: ./scripts/check-qbittorrent.sh [ssh-target] [url]
# Example: ./scripts/check-qbittorrent.sh ubuntu@192.168.8.10 http://192.168.8.10:8082

set -euo pipefail

SSH_TARGET=${1:-}
URL=${2:-http://192.168.8.10:8082}

echo "Checking qBittorrent UI at: $URL"
if command -v curl >/dev/null 2>&1; then
  if curl -I --max-time 5 -sS "$URL" -o /dev/null; then
    echo "[OK] $URL is reachable (HTTP response received)"
  else
    echo "[WARN] $URL did not respond to HTTP request"
  fi
else
  echo "curl not found — skipping local HTTP check"
fi

if [ -n "$SSH_TARGET" ]; then
  echo
  echo "Running remote diagnostics on $SSH_TARGET"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_TARGET" bash -s <<'SSH_EOF'
echo "--- systemctl status (qbittorrent) ---"
sudo systemctl status qbittorrent-nox --no-pager || sudo systemctl status qbittorrent.service --no-pager || ps aux | grep -i qbittorrent | grep -v grep || true
echo
echo "--- listening ports (8082) ---"
sudo ss -ltnp 2>/dev/null | grep ':8082' || sudo netstat -ltnp 2>/dev/null | grep ':8082' || echo "no listener on 8082"
echo
echo "--- recent journal (qbittorrent) ---"
sudo journalctl -u qbittorrent-nox -n 120 --no-pager 2>/dev/null || sudo journalctl -u qbittorrent.service -n 120 --no-pager 2>/dev/null || true
echo
echo "--- effective user and config ---"
getent passwd qbittorrent qbt debian-transmission 2>/dev/null || true
echo "config locations to inspect: /etc/qBittorrent/, ~/.config/qBittorrent/, /var/lib/qbittorrent/"
SSH_EOF
fi

echo
echo "Done. If the UI is unreachable but the service is running, check firewall (ufw/iptables) and that qBittorrent is bound to 0.0.0.0 or the Pi IP (not 127.0.0.1)."

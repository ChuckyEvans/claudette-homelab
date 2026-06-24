#!/usr/bin/env bash
# Helper to configure UFW for Claudette host security
# Usage: sudo ./ufw.sh apply|remove|status

set -euo pipefail

CMD=${1:-}
if [[ -z "$CMD" ]]; then
  echo "Usage: sudo $0 apply|remove|status"
  exit 2
fi

apply() {
  echo "Resetting UFW and applying recommended rules for Claudette..."
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing

  # Allow loopback
  ufw allow from 127.0.0.1 to any
  ufw allow from ::1 to any

  # Allow local LAN subnets (adjust if your LAN differs)
  ufw allow from 192.168.8.0/24 to any
  ufw allow from 192.168.68.0/24 to any

  # Restrict Docker forwarded ports: deny by default (optional)
  # If you expose a specific port publicly, add a rule here, e.g.:
  # ufw allow 7654/tcp

  ufw --force enable
  echo "UFW applied. Current status:"
  ufw status verbose
}

remove() {
  echo "Resetting UFW to defaults (allow all outgoing, deny incoming) and disabling..."
  ufw --force reset
  ufw default allow outgoing
  ufw default allow incoming
  ufw --force disable
  echo "UFW reset and disabled."
}

status() {
  ufw status verbose || true
}

case "$CMD" in
  apply)  apply ;;
  remove) remove ;;
  status) status ;;
  *) echo "Unknown command: $CMD"; exit 2 ;;
esac

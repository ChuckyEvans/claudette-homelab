#!/usr/bin/env bash
# scripts/linux/restart.sh
# Build and run Claudette locally using Docker on Linux or macOS.
#
# Requirements: Docker
#
# Usage (from repo root):
#   ./scripts/linux/restart.sh               # full build + restart
#   ./scripts/linux/restart.sh --skip-build  # restart without rebuilding the image
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1; shift ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

IMAGE_NAME="claudette:latest"
CONTAINER_NAME="claudette"

echo ""
echo -e "\033[36mDeploying Claudette locally ($(uname -s) / Docker)\033[0m"
echo "─────────────────────────────────────────────"

# ── 1. Stop and remove existing container ────────────────────────────────────
echo ""
echo -e "\033[36m[1/3] Stopping existing container...\033[0m"
if docker ps -aq --filter "name=^${CONTAINER_NAME}$" | grep -q .; then
    docker stop "$CONTAINER_NAME" > /dev/null
    docker rm   "$CONTAINER_NAME" > /dev/null
    echo -e "      \033[32mStopped and removed '$CONTAINER_NAME'.\033[0m"
else
    echo "      No running container found, skipping."
fi

# ── 2. Build image ────────────────────────────────────────────────────────────
if [[ $SKIP_BUILD -eq 0 ]]; then
    echo ""
    echo -e "\033[36m[2/3] Building image '$IMAGE_NAME'...\033[0m"
    cd "$PROJECT_DIR"
    docker build -t "$IMAGE_NAME" .
    echo -e "      \033[32mBuild successful.\033[0m"
else
    echo ""
    echo -e "\033[90m[2/3] Skipping build (--skip-build flag set).\033[0m"
fi

# ── 3. Start container ────────────────────────────────────────────────────────
echo ""
echo -e "\033[36m[3/3] Starting container '$CONTAINER_NAME'...\033[0m"

# Mount DHCP leases if found (dnsmasq) for hostname enrichment
EXTRA_MOUNTS=()
for f in /etc/pihole/dhcp.leases /var/lib/misc/dnsmasq.leases; do
    if [[ -f "$f" ]]; then
        EXTRA_MOUNTS+=(-v "${f}:/data/dhcp.leases:ro")
        echo "      DHCP leases: $f will be mounted for hostname enrichment."
        break
    fi
done

# On Linux, Docker runs natively — use --network host so nmap can ARP-scan
# the LAN and get real MAC addresses + vendor info, and so speedtests run
# without VM overhead. On macOS, Docker runs in a VM (like Windows Docker
# Desktop), so --network host doesn't reach the physical LAN; use -p instead.
OS_TYPE="$(uname -s)"
if [[ "$OS_TYPE" == "Linux" ]]; then
    NETWORK_ARGS=(--network host)
    echo "      Network: host (Linux native — ARP scanning and full-speed tests enabled)"
else
    NETWORK_ARGS=(-p 7654:7654)
    echo "      Network: bridge (macOS — ARP scanning and speedtest accuracy limited by Docker VM)"
fi

docker run -d \
    --name      "$CONTAINER_NAME" \
    --restart   unless-stopped \
    --cap-add   NET_ADMIN \
    --cap-add   NET_RAW \
    "${NETWORK_ARGS[@]}" \
    -v          claudette-data:/app/data \
    "${EXTRA_MOUNTS[@]+"${EXTRA_MOUNTS[@]}"}" \
    "$IMAGE_NAME"

echo ""
echo -e "\033[32mClaudette is running at http://localhost:7654\033[0m"
echo "Logs: docker logs -f $CONTAINER_NAME"
echo ""

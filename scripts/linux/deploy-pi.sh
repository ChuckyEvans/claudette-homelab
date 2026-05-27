#!/usr/bin/env bash
# scripts/linux/deploy-pi.sh
# Build an ARM64 Docker image and deploy it to the Raspberry Pi via SSH.
# Run this from a Linux or macOS machine.
#
# Requirements: Docker (with buildx), OpenSSH client, scp
#
# Usage (from repo root):
#   ./scripts/linux/deploy-pi.sh                     # full build + deploy (reads config.yaml)
#   ./scripts/linux/deploy-pi.sh --skip-build        # re-use last claudette-arm64.tar
#   ./scripts/linux/deploy-pi.sh --host 192.168.1.50 # override Pi host
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PI_HOST=""
PI_USER=""
SSH_KEY=""
SKIP_BUILD=0
KODI_HOST=""
KODI_USER="root"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --host)       PI_HOST="$2";  shift 2 ;;
        --user)       PI_USER="$2";  shift 2 ;;
        --key)        SSH_KEY="$2";  shift 2 ;;
        --skip-build) SKIP_BUILD=1;  shift   ;;
        --kodi-host)  KODI_HOST="$2"; shift 2 ;;
        --kodi-user)  KODI_USER="$2"; shift 2 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

# ── Configuration (reads config.yaml if not overridden) ───────────────────────
read_yaml() {
    local key="$1" default="$2"
    local cfg="$PROJECT_DIR/config.yaml"
    if [[ -f "$cfg" ]]; then
        local val
        val=$(grep -E "^\s*${key}:" "$cfg" | head -1 | sed "s/^\s*${key}:\s*//;s/['\"]//g;s/[[:space:]]*$//")
        echo "${val:-$default}"
    else
        echo "$default"
    fi
}

[[ -z "$PI_HOST" ]] && PI_HOST=$(read_yaml host     "192.168.1.10")
[[ -z "$PI_USER" ]] && PI_USER=$(read_yaml ssh_user "ubuntu")
if [[ -z "$SSH_KEY" ]]; then
    raw=$(read_yaml ssh_key "")
    [[ -n "$raw" ]] && SSH_KEY="${raw/#\~/$HOME}"
fi

CONTAINER_NAME="claudette"
IMAGE_NAME="claudette:latest"
BUILDER_NAME="claudette-builder"
TAR_FILE="$PROJECT_DIR/claudette-arm64.tar"
REMOTE_TAR="/tmp/claudette-arm64.tar"

SSH_ARGS=(-o StrictHostKeyChecking=no -o BatchMode=yes)
[[ -n "$SSH_KEY" ]] && SSH_ARGS+=(-i "$SSH_KEY")

run_ssh()        { ssh "${SSH_ARGS[@]}" "${PI_USER}@${PI_HOST}" "$1"; }
run_ssh_silent() { ssh "${SSH_ARGS[@]}" "${PI_USER}@${PI_HOST}" "$1" 2>/dev/null || true; }

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "\033[36mDeploying Claudette to ${PI_USER}@${PI_HOST}\033[0m"
echo "─────────────────────────────────────────────"

# ── 1. Build ARM64 image ──────────────────────────────────────────────────────
echo ""
echo -e "\033[36m[1/4] Building ARM64 image (linux/arm64)...\033[0m"

if [[ $SKIP_BUILD -eq 1 ]]; then
    if [[ ! -f "$TAR_FILE" ]]; then
        echo "No tarball at '$TAR_FILE'. Run without --skip-build first." >&2
        exit 1
    fi
    echo "      Skipping build, using existing tarball."
else
    if ! docker buildx ls 2>&1 | grep -q "$BUILDER_NAME"; then
        echo "      Creating multi-platform buildx builder..."
        docker buildx create --name "$BUILDER_NAME" --driver docker-container --bootstrap > /dev/null
    fi
    docker buildx use "$BUILDER_NAME"
    cd "$PROJECT_DIR"
    docker buildx build \
        --platform linux/arm64 \
        --tag "$IMAGE_NAME" \
        --output "type=docker,dest=${TAR_FILE}" \
        .
    SIZE=$(du -m "$TAR_FILE" | cut -f1)
    echo -e "      \033[32mBuilt. Tarball: ${SIZE} MB\033[0m"
fi

# ── 2. Copy image to Pi ───────────────────────────────────────────────────────
echo ""
echo -e "\033[36m[2/4] Copying image to Pi...\033[0m"
scp "${SSH_ARGS[@]}" "$TAR_FILE" "${PI_USER}@${PI_HOST}:${REMOTE_TAR}"
echo -e "      \033[32mCopied.\033[0m"

# ── 3. Load image on Pi ───────────────────────────────────────────────────────
echo ""
echo -e "\033[36m[3/4] Loading image on Pi...\033[0m"
run_ssh "sudo docker load -i ${REMOTE_TAR} && rm ${REMOTE_TAR}"
echo -e "      \033[32mLoaded.\033[0m"

# ── 4. Restart container on Pi ────────────────────────────────────────────────
echo ""
echo -e "\033[36m[4/4] Restarting container on Pi...\033[0m"

run_ssh "sudo docker stop ${CONTAINER_NAME} 2>/dev/null || true"
run_ssh "sudo docker rm   ${CONTAINER_NAME} 2>/dev/null || true"

# Probe for a DHCP leases file (Pi-hole or dnsmasq) and mount if present
LEASES_MOUNT=""
LEASES_PATH=$(run_ssh_silent "ls /etc/pihole/dhcp.leases /var/lib/misc/dnsmasq.leases 2>/dev/null | head -1")
if [[ -n "${LEASES_PATH// /}" ]]; then
    LEASES_MOUNT="-v ${LEASES_PATH}:/data/dhcp.leases:ro"
    echo "      DHCP leases: $LEASES_PATH will be mounted."
else
    echo "      No DHCP leases file found — hostnames from DNS only."
fi

run_ssh "sudo docker run -d \
  --name $CONTAINER_NAME \
  --restart unless-stopped \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --network host \
  $LEASES_MOUNT \
  -v claudette-data:/app/data \
  $IMAGE_NAME"

echo -e "      \033[32mContainer started.\033[0m"
echo ""
echo -e "\033[32mClaudette is running at http://${PI_HOST}:7654\033[0m"
echo "Logs: ssh ${PI_USER}@${PI_HOST} 'docker logs -f ${CONTAINER_NAME}'"
echo ""

# ── 5. Deploy Kodi addon (optional) ─────────────────────────────────────────────
if [[ -n "$KODI_HOST" ]]; then
    echo ""
    echo -e "\033[36m[5/5] Deploying Kodi addon to ${KODI_USER}@${KODI_HOST}...\033[0m"
    KODI_SSH_ARGS=(-o StrictHostKeyChecking=no -o BatchMode=yes)
    [[ -n "$SSH_KEY" ]] && KODI_SSH_ARGS+=(-i "$SSH_KEY")
    ADDON_SRC="$PROJECT_DIR/output/kodi/plugin.program.claudette"
    ADDON_DEST="/storage/.kodi/addons/"
    if scp "${KODI_SSH_ARGS[@]}" -r "$ADDON_SRC" "${KODI_USER}@${KODI_HOST}:${ADDON_DEST}"; then
        ssh "${KODI_SSH_ARGS[@]}" "${KODI_USER}@${KODI_HOST}" \
            'kodi-send --action="UpdateLocalAddons" 2>/dev/null || true' 2>/dev/null || true
        echo -e "      \033[32mKodi addon deployed. In Kodi: Settings → Add-ons → My Add-ons → Program add-ons → Claudette\033[0m"
    else
        echo "      Warning: Kodi scp failed — addon not deployed." >&2
    fi
fi

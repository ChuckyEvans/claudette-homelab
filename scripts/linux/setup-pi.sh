#!/usr/bin/env bash
# scripts/linux/setup-pi.sh
# ─────────────────────────────────────────────────────────────────────────────
# First-time setup for a Raspberry Pi (or any Debian/Ubuntu host) running
# Claudette.  Run this ONCE on the Pi itself after a fresh OS install.
#
# What this script does:
#   1.  Installs Docker (with the ubuntu user in the docker group)
#   2.  Installs nginx, certbot (python3-certbot-nginx), fail2ban, ufw
#   3.  Configures UFW firewall (deny inbound by default; allow 22/80/443/7443/8443)
#   4.  Writes the nginx site config with rate-limiting and security headers
#   5.  Obtains a Let's Encrypt TLS certificate via certbot (HTTP-01 challenge)
#   6.  Configures fail2ban jails for SSH, nginx rate-limit, and Claudette login
#   7.  Enables and starts all services
#   8.  Verifies the certificate is trusted
#
# Usage (run on the Pi, NOT from your dev machine):
#   chmod +x setup-pi.sh
#   sudo ./setup-pi.sh
#
# Options:
#   --domain <name>       Public hostname, e.g. mypi.hopto.org (prompted if omitted)
#   --user <name>         OS user to add to the docker group (default: ubuntu)
#   --no-ha               Skip the Home Assistant (8443) nginx block
#   --skip-certbot        Skip Let's Encrypt (useful for LAN-only setups)
#   --skip-firewall       Skip UFW configuration
#   --skip-fail2ban       Skip fail2ban configuration
#
# After running this script you still need to:
#   - Place your config.yaml in /home/<user>/claudette/data/ (or let deploy create it)
#   - Run the deploy script from your dev machine: npm run deploy (or deploy-pi.ps1)
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()     { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}── $* ${RESET}"; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run this script as root: sudo $0 $*"

# ── Defaults ─────────────────────────────────────────────────────────────────
DOMAIN=""
OS_USER="ubuntu"
SETUP_HA=1
SKIP_CERTBOT=0
SKIP_FIREWALL=0
SKIP_FAIL2BAN=0

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)        DOMAIN="$2";    shift 2 ;;
        --user)          OS_USER="$2";   shift 2 ;;
        --no-ha)         SETUP_HA=0;     shift   ;;
        --skip-certbot)  SKIP_CERTBOT=1; shift   ;;
        --skip-firewall) SKIP_FIREWALL=1;shift   ;;
        --skip-fail2ban) SKIP_FAIL2BAN=1;shift   ;;
        *) die "Unknown argument: $1" ;;
    esac
done

# ── Interactive prompts ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Claudette — Pi First-Time Setup${RESET}"
echo "─────────────────────────────────────────────"

if [[ -z "$DOMAIN" && $SKIP_CERTBOT -eq 0 ]]; then
    echo ""
    read -rp "  Public domain name (e.g. mypi.hopto.org): " DOMAIN
    [[ -n "$DOMAIN" ]] || die "Domain name is required unless --skip-certbot is used."
fi

if [[ -z "$DOMAIN" ]]; then
    warn "No domain specified — skipping nginx TLS config (LAN-only mode)."
fi

echo ""
info "Settings:"
info "  OS user    : $OS_USER"
info "  Domain     : ${DOMAIN:-<none — LAN only>}"
info "  Home Asst  : $([ $SETUP_HA -eq 1 ] && echo yes || echo no)"
info "  certbot    : $([ $SKIP_CERTBOT -eq 0 ] && echo yes || echo no)"
info "  UFW        : $([ $SKIP_FIREWALL -eq 0 ] && echo yes || echo no)"
info "  fail2ban   : $([ $SKIP_FAIL2BAN -eq 0 ] && echo yes || echo no)"
echo ""
read -rp "  Proceed? [Y/n] " CONFIRM
[[ "${CONFIRM:-Y}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── 1. System update + package install ───────────────────────────────────────
section "1/7  Installing packages"
apt-get update -qq
PACKAGES=(ca-certificates curl gnupg lsb-release nginx ufw)
[[ $SKIP_FAIL2BAN -eq 0 ]] && PACKAGES+=(fail2ban)
if [[ $SKIP_CERTBOT -eq 0 && -n "$DOMAIN" ]]; then
    PACKAGES+=(certbot python3-certbot-nginx)
fi
apt-get install -y -qq "${PACKAGES[@]}"
ok "Packages installed."

# ── 2. Docker ─────────────────────────────────────────────────────────────────
section "2/7  Installing Docker"
if command -v docker &>/dev/null; then
    ok "Docker already installed ($(docker --version | cut -d' ' -f3 | tr -d ','))."
else
    info "Adding Docker APT repository..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    ok "Docker installed."
fi

# Add OS user to docker group so they can run docker without sudo
if id "$OS_USER" &>/dev/null; then
    if ! groups "$OS_USER" | grep -q docker; then
        usermod -aG docker "$OS_USER"
        ok "Added $OS_USER to the docker group."
        warn "Log out and back in as $OS_USER for docker group to take effect."
    else
        ok "$OS_USER already in docker group."
    fi
else
    warn "User '$OS_USER' not found — skipping docker group membership."
fi

systemctl enable --now docker
ok "Docker service enabled and running."

# ── 3. UFW firewall ───────────────────────────────────────────────────────────
section "3/7  Configuring UFW firewall"
if [[ $SKIP_FIREWALL -eq 0 ]]; then
    # Allow before enabling so we don't lock ourselves out
    ufw allow 22/tcp   comment 'SSH'                    > /dev/null
    ufw allow 80/tcp   comment 'HTTP (certbot renewal)' > /dev/null
    ufw allow 443/tcp  comment 'HTTPS liveness'         > /dev/null
    ufw allow 7443/tcp comment 'Claudette HTTPS'        > /dev/null
    [[ $SETUP_HA -eq 1 ]] && ufw allow 8443/tcp comment 'Home Assistant HTTPS' > /dev/null
    # Default: deny all inbound except what we've allowed
    ufw default deny incoming  > /dev/null
    ufw default allow outgoing > /dev/null
    # Enable non-interactively
    ufw --force enable
    ok "UFW enabled. Active rules:"
    ufw status numbered
else
    warn "Skipping UFW configuration (--skip-firewall passed)."
fi

# ── 4. nginx site config ──────────────────────────────────────────────────────
section "4/7  Writing nginx config"

# Shared rate-limit zone config (put in /etc/nginx/conf.d/ so it's in the http{} block)
cat > /etc/nginx/conf.d/claudette-limits.conf << 'NGINXLIMITS'
# Claudette rate-limit zones
limit_req_zone $binary_remote_addr zone=claudette_login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=claudette_general:10m rate=30r/s;
server_tokens off;
NGINXLIMITS
ok "Rate-limit zones written."

# Disable the default nginx site
rm -f /etc/nginx/sites-enabled/default

if [[ -n "$DOMAIN" ]]; then
    # Determine HA block
    HA_BLOCK=""
    if [[ $SETUP_HA -eq 1 ]]; then
        HA_BLOCK=$(cat << HABLOCK

# HTTPS 8443 — Home Assistant
server {
    listen 8443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        limit_req zone=claudette_general burst=80 nodelay;
        proxy_pass         http://127.0.0.1:8123;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection \$connection_upgrade;
        proxy_http_version 1.1;
    }
}
HABLOCK
)
    fi

    # Write the full site config (without TLS first; certbot will patch it in)
    cat > /etc/nginx/sites-available/claudette << NGINXSITE
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      keep-alive;
}

# HTTP — Let's Encrypt renewal + liveness probe
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 '{"ok":true}'; add_header Content-Type application/json; }
}
NGINXSITE

    ln -sf /etc/nginx/sites-available/claudette /etc/nginx/sites-enabled/claudette
    nginx -t
    systemctl reload nginx
    ok "Temporary HTTP-only nginx config written and loaded."
else
    # LAN-only: plain HTTP proxy, no TLS
    cat > /etc/nginx/sites-available/claudette << 'NGINXLAN'
# Claudette — LAN-only HTTP proxy (no TLS)
server {
    listen 7654;
    server_name _;
    location / {
        proxy_pass         http://127.0.0.1:7654;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_http_version 1.1;
    }
}
NGINXLAN
    ln -sf /etc/nginx/sites-available/claudette /etc/nginx/sites-enabled/claudette
    ok "LAN-only nginx config written."
fi

# ── 5. Let's Encrypt certificate ──────────────────────────────────────────────
section "5/7  Obtaining TLS certificate"
if [[ $SKIP_CERTBOT -eq 0 && -n "$DOMAIN" ]]; then
    read -rp "  Email for Let's Encrypt expiry notices: " LE_EMAIL
    [[ -n "$LE_EMAIL" ]] || die "Email is required for Let's Encrypt."

    if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
        ok "Certificate already exists for ${DOMAIN} — skipping issuance."
        info "Run 'sudo certbot renew --dry-run' to test auto-renewal."
    else
        info "Requesting certificate for ${DOMAIN}..."
        certbot --nginx \
            --non-interactive \
            --agree-tos \
            --email "$LE_EMAIL" \
            --domains "$DOMAIN" \
            --redirect
        ok "Certificate issued successfully."
    fi

    # Now write the full TLS config (certbot may have partially written it;
    # we overwrite with our hardened version that covers all four server blocks)
    cat > /etc/nginx/sites-available/claudette << NGINXTLS
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      keep-alive;
}

# HTTP — Let's Encrypt renewal + liveness probe
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 '{"ok":true}'; add_header Content-Type application/json; }
}

# HTTPS 443 — liveness probe only
server {
    listen 443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
    add_header Strict-Transport-Security "max-age=63072000" always;
    location / { return 200 '{"ok":true}'; add_header Content-Type application/json; }
}

# HTTPS 7443 — Claudette
server {
    listen 7443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Strict rate limit on auth endpoint
    location /api/auth/login {
        limit_req zone=claudette_login burst=3 nodelay;
        proxy_pass         http://127.0.0.1:7654;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
    }

    location / {
        limit_req zone=claudette_general burst=60 nodelay;
        proxy_pass         http://127.0.0.1:7654;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection \$connection_upgrade;
        proxy_http_version 1.1;
    }
}
${HA_BLOCK}
NGINXTLS

    nginx -t
    systemctl reload nginx
    ok "Hardened TLS nginx config applied."

    # Verify the certificate is trusted from localhost
    info "Verifying certificate chain..."
    VERIFY=$(echo | openssl s_client -connect "${DOMAIN}:7443" -servername "${DOMAIN}" 2>&1 | grep "Verify return code")
    if echo "$VERIFY" | grep -q "ok (0)"; then
        ok "Certificate verified: $VERIFY"
    else
        warn "Certificate verification returned: $VERIFY"
        warn "This may be normal if DNS hasn't propagated yet, or port 7443 is not yet open in your router."
    fi
else
    warn "Skipping Let's Encrypt (--skip-certbot passed or no domain)."
fi

# ── 6. fail2ban ───────────────────────────────────────────────────────────────
section "6/7  Configuring fail2ban"
if [[ $SKIP_FAIL2BAN -eq 0 ]]; then
    # Write a local jail config that won't be overwritten by package updates
    cat > /etc/fail2ban/jail.d/claudette.conf << 'F2BCONF'
[DEFAULT]
bantime  = 3600
findtime = 300
maxretry = 5
banaction = ufw

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s
maxretry = 5

[nginx-limit-req]
enabled  = true
port     = http,https,7443,8443
logpath  = /var/log/nginx/error.log
maxretry = 10
findtime = 60

[claudette-auth]
enabled  = true
port     = 7443
logpath  = /var/log/nginx/access.log
filter   = claudette-auth
maxretry = 8
findtime = 300
F2BCONF

    # Write the filter that matches 429 (rate-limit) responses on the login path
    cat > /etc/fail2ban/filter.d/claudette-auth.conf << 'F2BFILTER'
[Definition]
# Ban IPs that receive HTTP 429 on the Claudette login endpoint
failregex = ^<HOST> .* "POST /api/auth/login HTTP/[0-9.]+" 429
ignoreregex =
F2BFILTER

    systemctl enable fail2ban
    systemctl restart fail2ban
    ok "fail2ban configured and running."
    info "Active jails:"
    fail2ban-client status 2>/dev/null | grep "Jail list" || true
else
    warn "Skipping fail2ban configuration (--skip-fail2ban passed)."
fi

# ── 7. Certbot auto-renewal timer ─────────────────────────────────────────────
section "7/7  Certbot auto-renewal"
if [[ $SKIP_CERTBOT -eq 0 && -n "$DOMAIN" ]]; then
    if systemctl is-enabled certbot.timer &>/dev/null; then
        ok "certbot.timer already enabled (auto-renewal active)."
    else
        systemctl enable --now certbot.timer 2>/dev/null && ok "certbot.timer enabled." \
            || warn "certbot.timer not available — checking cron..."
    fi
    # Dry-run to confirm renewal works
    info "Testing certbot renewal (dry-run)..."
    if certbot renew --dry-run --quiet 2>/dev/null; then
        ok "Certbot dry-run passed — auto-renewal will work."
    else
        warn "Certbot dry-run failed — check that port 80 is reachable from the internet."
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete!${RESET}"
echo ""
echo -e "  Next steps:"
echo -e "  1. If Docker group was just added, log out and back in as ${BOLD}${OS_USER}${RESET}"
echo -e "  2. Forward these ports on your router to ${BOLD}$(hostname -I | awk '{print $1}')${RESET}:"
echo -e "       80  → Pi:80   (certbot renewal)"
echo -e "       7443 → Pi:7443 (Claudette)"
[[ $SETUP_HA -eq 1 ]] && echo -e "       8443 → Pi:8443 (Home Assistant)"
echo -e "  3. Deploy Claudette from your dev machine:"
echo -e "       ${BOLD}npm run deploy${RESET}   (or  scripts/windows/deploy-pi.ps1)"
echo ""
[[ -n "$DOMAIN" ]] && echo -e "  Claudette will be live at: ${BOLD}https://${DOMAIN}:7443${RESET}"
echo ""

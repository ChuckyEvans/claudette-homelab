#!/bin/bash
set -e
# write empty CONFIG_URL to disable automatic updates (opt-out)
cat > /etc/openvpn/ovpn-update.conf <<'CONF'
CONFIG_URL=""
CONF

# stop and disable the updater timer/service if present
systemctl stop ovpn-update.timer ovpn-update.service 2>/dev/null || true
systemctl disable ovpn-update.timer ovpn-update.service 2>/dev/null || true

# ensure auth.txt exists and has correct perms
if [ ! -f /etc/openvpn/auth.txt ]; then
  for f in /root/ovpn-backups/*/auth.txt; do
    if [ -f "${f}" ]; then
      cp -a "${f}" /etc/openvpn/auth.txt && break
    fi
  done
fi
chown root:root /etc/openvpn/auth.txt || true
chmod 600 /etc/openvpn/auth.txt || true

# restart OpenVPN and routing
systemctl restart openvpn-us8373.service || true
systemctl restart vpn-routing.service || true

# verify and print status
echo "--- openvpn status ---"
systemctl status openvpn-us8373.service --no-pager || true

echo "--- tun0 ---"
ip addr show tun0 || true

echo "--- ip rules ---"
ip rule list || true

echo "--- table 200 ---"
ip route show table 200 || true

echo "--- iptables mangle ---"
iptables -t mangle -L OUTPUT -n --line-numbers || true

echo "--- iptables filter ---"
iptables -L OUTPUT -n --line-numbers || true

TRAN_UID=$(getent passwd debian-transmission | cut -d: -f3 || echo 114)
echo "TRAN_UID=${TRAN_UID}"

# egress tests
sudo -u "#${TRAN_UID}" curl -sS --connect-timeout 10 --max-time 15 https://ifconfig.co || true
curl -x http://127.0.0.1:3128 -sS --connect-timeout 10 --max-time 15 https://ifconfig.co || true

echo DONE

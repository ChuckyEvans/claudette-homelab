#!/bin/bash
set -e
TS=$(date +%s)
echo "1) write updater config"
cat > /etc/openvpn/ovpn-update.conf <<'CONF'
CONFIG_URL="https://downloads.nordcdn.com/configs/archives/servers/ovpn/tcp.zip"
CONF

echo "2) stop openvpn"
systemctl stop openvpn-us8373.service || true

echo "3) run updater"
if [ -x /usr/local/bin/ovpn-update.sh ]; then
  /usr/local/bin/ovpn-update.sh || { echo "UPDATER_FAILED"; exit 2; }
else
  echo "UPDATER_NOT_FOUND"; exit 3
fi

echo "4) ensure auth preserved"
if [ ! -f /etc/openvpn/auth.txt ]; then
  for f in /root/ovpn-backups/*/auth.txt; do
    if [ -f "${f}" ]; then
      cp -a "${f}" /etc/openvpn/auth.txt && break
    fi
  done
fi
chown root:root /etc/openvpn/auth.txt || true
chmod 600 /etc/openvpn/auth.txt || true
ls -l /etc/openvpn/auth.txt || true

echo "5) start openvpn and routing"
systemctl start openvpn-us8373.service || { echo openvpn-start-failed; exit 4; }
systemctl restart vpn-routing.service || true

echo "6) verification"
ip rule list || true
ip route show table 200 || true
iptables -t mangle -L OUTPUT -n --line-numbers || true
iptables -L OUTPUT -n --line-numbers || true
TRAN_UID=$(getent passwd debian-transmission | cut -d: -f3 || echo 114)
echo "TRAN_UID=${TRAN_UID}"
sudo -u "#${TRAN_UID}" curl -sS --connect-timeout 10 --max-time 15 https://ifconfig.co || true
curl -x http://127.0.0.1:3128 -sS --connect-timeout 10 --max-time 15 https://ifconfig.co || true

echo "DONE"

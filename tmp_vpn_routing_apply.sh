#!/bin/bash
set -euo pipefail
MARK=0x1
TABLE=200
WAIT=30
n=0
while [ $n -lt $WAIT ]; do
  if ip link show tun0 >/dev/null 2>&1; then break; fi
  n=$((n+1)); sleep 1
done
if ! ip link show tun0 >/dev/null 2>&1; then
  echo "vpn-routing-apply: tun0 not found after ${WAIT}s; aborting" >&2
  exit 1
fi
if ! ip rule | grep -q "fwmark 0x1 lookup vpn"; then
  ip rule add fwmark 0x1 table $TABLE
fi
ip route replace default dev tun0 table $TABLE
find_uid() {
  for name in "$@"; do
    uid=$(getent passwd "$name" | cut -d: -f3 || true)
    if [ -n "$uid" ]; then echo "$uid"; return 0; fi
  done
  return 1
}
TRAN_UID=""
if find_uid debian-transmission transmission; then TRAN_UID=$(find_uid debian-transmission transmission); else TRAN_UID=114; fi
SQUID_UID=""
if find_uid proxy squid squiduser; then SQUID_UID=$(find_uid proxy squid squiduser); else
  pid=$(ss -ltnp sport = :3128 2>/dev/null | sed -n "s/.*pid=\([0-9]*\),.*/\1/p" | head -n1 || true)
  if [ -n "$pid" ] && [ -r /proc/$pid/status ]; then
    SQUID_UID=$(awk '/^Uid:/ {print \$2}' /proc/$pid/status)
  fi
fi
if ! iptables -t mangle -C OUTPUT -m owner --uid-owner "$TRAN_UID" -j MARK --set-mark $MARK 2>/dev/null; then
  iptables -t mangle -A OUTPUT -m owner --uid-owner "$TRAN_UID" -j MARK --set-mark $MARK
fi
if [ -n "$SQUID_UID" ]; then
  if ! iptables -t mangle -C OUTPUT -m owner --uid-owner "$SQUID_UID" -j MARK --set-mark $MARK 2>/dev/null; then
    iptables -t mangle -A OUTPUT -m owner --uid-owner "$SQUID_UID" -j MARK --set-mark $MARK
  fi
fi
if ! iptables -C OUTPUT -m owner --uid-owner "$TRAN_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable 2>/dev/null; then
  iptables -A OUTPUT -m owner --uid-owner "$TRAN_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable
fi
if [ -n "$SQUID_UID" ]; then
  if ! iptables -C OUTPUT -m owner --uid-owner "$SQUID_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable 2>/dev/null; then
    iptables -A OUTPUT -m owner --uid-owner "$SQUID_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable
  fi
fi

echo "vpn-routing-apply: applied table=$TABLE mark=$MARK TRAN_UID=$TRAN_UID SQUID_UID=${SQUID_UID:-none}"

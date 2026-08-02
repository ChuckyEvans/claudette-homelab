#!/bin/bash
set -euo pipefail
MARK=0x1
TABLE=200
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
if iptables -t mangle -C OUTPUT -m owner --uid-owner "$TRAN_UID" -j MARK --set-mark $MARK 2>/dev/null; then
  iptables -t mangle -D OUTPUT -m owner --uid-owner "$TRAN_UID" -j MARK --set-mark $MARK
fi
if [ -n "$SQUID_UID" ] && iptables -t mangle -C OUTPUT -m owner --uid-owner "$SQUID_UID" -j MARK --set-mark $MARK 2>/dev/null; then
  iptables -t mangle -D OUTPUT -m owner --uid-owner "$SQUID_UID" -j MARK --set-mark $MARK
fi
if iptables -C OUTPUT -m owner --uid-owner "$TRAN_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable 2>/dev/null; then
  iptables -D OUTPUT -m owner --uid-owner "$TRAN_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable
fi
if [ -n "$SQUID_UID" ] && iptables -C OUTPUT -m owner --uid-owner "$SQUID_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable 2>/dev/null; then
  iptables -D OUTPUT -m owner --uid-owner "$SQUID_UID" -m mark ! --mark $MARK -j REJECT --reject-with icmp-port-unreachable
fi
ip rule del fwmark 0x1 table $TABLE 2>/dev/null || true
ip route flush table $TABLE 2>/dev/null || true

echo "vpn-routing-remove: removed rules for TRAN_UID=$TRAN_UID SQUID_UID=${SQUID_UID:-none}"

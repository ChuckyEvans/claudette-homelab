#!/usr/bin/env bash
set -euo pipefail

# scripts/net-check.sh
# Check connectivity to a list of targets over the direct/default interface and tun0.
# Exits with code 0 if all targets reachable on at least one path, or 2 if any target fails (policy: any failure = outage).

TARGETS=("1.1.1.1" "8.8.8.8" "google.co.za" "google.com")
TUN_IF="tun0"

json_escape() { printf '%s' "$1" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' ; }

# detect default interface (source of route to 8.8.8.8)
DEFAULT_IF=$(ip route get 8.8.8.8 2>/dev/null | awk '/dev/ { for(i=1;i<=NF;i++){ if($i=="dev") print $(i+1) } }' | head -1 || true)
if [ -z "$DEFAULT_IF" ]; then
  # fallback to common names
  for ifc in eth0 wlan0 enp0s3; do
    if ip link show "$ifc" >/dev/null 2>&1; then DEFAULT_IF=$ifc; break; fi
  done
fi
DEFAULT_IF=${DEFAULT_IF:-eth0}

echo "Using direct interface: $DEFAULT_IF  and VPN interface: $TUN_IF"

results_direct=()
results_tun=()
failed_any=0

ping_one() {
  local iface=$1 target=$2
  if ip link show "$iface" >/dev/null 2>&1; then
    if ping -I "$iface" -c 3 -W 2 "$target" >/dev/null 2>&1; then
      echo "ok"
      return 0
    else
      echo "fail"
      return 1
    fi
  else
    echo "noiface"
    return 2
  fi
}

for t in "${TARGETS[@]}"; do
  d=$(ping_one "$DEFAULT_IF" "$t") || true
  results_direct+=("$d")
  v=$(ping_one "$TUN_IF" "$t") || true
  results_tun+=("$v")
  if [ "$d" != "ok" ] && [ "$v" != "ok" ]; then
    failed_any=1
  fi
done

# build JSON summary
out="{\"direct_iface\":\"$DEFAULT_IF\",\"tun_iface\":\"$TUN_IF\",\"targets\":["
for i in "${!TARGETS[@]}"; do
  t=${TARGETS[$i]}
  d=${results_direct[$i]}
  v=${results_tun[$i]}
  out+="{\"target\":\"$t\",\"direct\":\"$d\",\"tun\":\"$v\"}"
  if [ $i -lt $((${#TARGETS[@]}-1)) ]; then out+=","; fi
done
out+="]}"

echo
echo "$out" | python -m json.tool

if [ $failed_any -eq 1 ]; then
  echo "OUTAGE: one or more targets unreachable on both paths" >&2
  exit 2
fi

echo "All targets reachable on at least one path." >&2
exit 0

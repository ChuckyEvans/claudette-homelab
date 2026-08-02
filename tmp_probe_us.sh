#!/bin/sh
set -e
# Extract remotes from .ovpn files
grep -h "^remote " /etc/openvpn/ovpn_tcp/*.ovpn 2>/dev/null | awk '{print $2":"$3}' | sed 's/:0$/:443/' | sort -u > /tmp/all_remotes.txt
if [ ! -s /tmp/all_remotes.txt ]; then echo "No remotes found"; exit 1; fi

echo "Geolocating remotes (ip-api.com) ..."
: > /tmp/us_candidates.txt
while IFS=: read -r host port; do
  [ -z "$host" ] && continue
  ip="$host"
  if echo "$host" | grep -q '[A-Za-z]'; then
    ip=$(getent hosts "$host" | awk '{print $1}' | head -n1 || echo "$host")
  fi
  geo=$(curl -s "http://ip-api.com/json/$ip?fields=status,countryCode" || true)
  status=$(echo "$geo" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' || true)
  cc=$(echo "$geo" | sed -n 's/.*"countryCode":"\([^"]*\)".*/\1/p' || true)
  if [ "$status" = "success" ] && [ "$cc" = "US" ]; then
    echo "${host}:${port}" >> /tmp/us_candidates.txt
  fi
  sleep 0.2
done < /tmp/all_remotes.txt

if [ ! -s /tmp/us_candidates.txt ]; then echo "No US candidates found"; exit 1; fi

head -n 200 /tmp/us_candidates.txt > /tmp/us200_list.txt
printf "host,port,tcp,ping_ms\n" > /tmp/us200_results.csv
count=0
while IFS=: read -r host port; do
  [ -z "$host" ] && continue
  count=$((count+1))
  port=${port:-443}
  if timeout 3 bash -c "</dev/tcp/$host/$port" 2>/dev/null; then tcp=OK; else tcp=FAIL; fi
  ping_ms=NA
  if [ "$tcp" = "OK" ]; then
    tgt="$host"
    if echo "$host" | grep -q '[A-Za-z]'; then tgt=$(getent hosts "$host" | awk '{print $1}' | head -n1 || echo "$host"); fi
    ping_out=$(ping -c 3 -W 2 "$tgt" 2>/dev/null || true)
    if echo "$ping_out" | grep -q "rtt"; then
      line=$(echo "$ping_out" | grep "rtt")
      vals=${line#*= }
      vals=${vals% ms}
      avg=$(echo "$vals" | cut -d'/' -f2)
      [ -n "$avg" ] && ping_ms=$avg
    fi
  fi
  echo "$host,$port,$tcp,$ping_ms" >> /tmp/us200_results.csv
done < /tmp/us200_list.txt

echo "Top reachable US servers (by avg ping ms):"
python3 - <<'PY'
import csv
rows=[]
with open('/tmp/us200_results.csv') as f:
    r=csv.reader(f)
    next(r)
    for host,port,tcp,ping in r:
        if tcp!='OK': continue
        try: p=float(ping)
        except: p=9999.0
        rows.append((p,host,port,ping))
rows.sort()
for p,host,port,ping in rows[:40]:
    print(f"{host}:{port}, avg_ping_ms={ping}")
PY

echo "CSV saved: /tmp/us200_results.csv"

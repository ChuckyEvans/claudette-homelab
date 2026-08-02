#!/bin/bash
set -e
DB=$(sudo find / -type f -name "claudette.db" 2>/dev/null | head -n1)
echo "DB:$DB"
if [ -z "$DB" ]; then echo DB_NOT_FOUND; exit 0; fi
echo "--- total network_outages ---"
sqlite3 "$DB" "SELECT COUNT(*) FROM network_outages;"
echo "--- recent 15 network_outages (start|end|duration_ms|uptime_before_ms|created_at) ---"
sqlite3 "$DB" "SELECT printf('%s|%s|%s|%s|%s', start, coalesce(end,''), coalesce(duration_ms,''), coalesce(uptime_before_ms,''), coalesce(created_at,'')) FROM network_outages ORDER BY start DESC LIMIT 15;"
echo "--- uptime_before_ms suspiciously small (<100000) rows ---"
sqlite3 "$DB" "SELECT printf('%s|%s|%s', start, coalesce(duration_ms,''), coalesce(uptime_before_ms,'')) FROM network_outages WHERE uptime_before_ms IS NOT NULL AND uptime_before_ms>0 AND uptime_before_ms<100000 ORDER BY start DESC LIMIT 20;"
echo "--- uptime_before_ms suspiciously large (>7 days ms) or negative ---"
THRESH=$(expr 7 \* 24 \* 3600 \* 1000)
sqlite3 "$DB" "SELECT printf('%s|%s|%s', start, coalesce(duration_ms,''), coalesce(uptime_before_ms,'')) FROM network_outages WHERE uptime_before_ms IS NOT NULL AND (uptime_before_ms>$THRESH OR uptime_before_ms<0) ORDER BY start DESC LIMIT 20;"

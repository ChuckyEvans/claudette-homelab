#!/bin/bash
set -e
DB=/home/ubuntu/claudette.db
if [ ! -f "$DB" ]; then echo DB_NOT_FOUND; exit 1; fi
TS=$(date +%s)
BACKUP=/root/claudette.db.bak.$TS
cp -a "$DB" "$BACKUP"
chmod 600 "$BACKUP"
echo BACKUP:$BACKUP

echo START_UPDATES
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
UPDATE network_outages SET uptime_before_ms = uptime_before_ms * 1000 WHERE uptime_before_ms IS NOT NULL AND uptime_before_ms > 0 AND uptime_before_ms < 100000;
UPDATE network_outages SET duration_ms = duration_ms * 1000 WHERE duration_ms IS NOT NULL AND duration_ms > 0 AND duration_ms < 100000;
UPDATE target_outages SET uptime_before_ms = uptime_before_ms * 1000 WHERE uptime_before_ms IS NOT NULL AND uptime_before_ms > 0 AND uptime_before_ms < 100000;
UPDATE target_outages SET duration_ms = duration_ms * 1000 WHERE duration_ms IS NOT NULL AND duration_ms > 0 AND duration_ms < 100000;
COMMIT;
SQL

echo UPDATED

echo "--- sample post-update network_outages ---"
sqlite3 "$DB" "SELECT printf('%s|%s|%s', start, coalesce(duration_ms,''), coalesce(uptime_before_ms,'')) FROM network_outages ORDER BY start DESC LIMIT 15;"

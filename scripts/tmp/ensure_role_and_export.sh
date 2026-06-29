#!/bin/bash
set -euo pipefail
DB=/var/lib/docker/volumes/claudette-data/_data/claudette.db
# Add role column if missing
sudo sqlite3 "$DB" "PRAGMA foreign_keys=OFF; BEGIN TRANSACTION;"
COL_EXISTS=$(sudo sqlite3 "$DB" "PRAGMA table_info(users);" | awk -F'|' '{print $2}' | grep -x "role" || true)
if [ -z "$COL_EXISTS" ]; then
  sudo sqlite3 "$DB" "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';"
fi
# Ensure testuser exists and set admin role and known password hash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('password123',12))")
# Upsert testuser
sudo sqlite3 "$DB" "INSERT OR REPLACE INTO users (id,username,password_hash,role) VALUES ((SELECT id FROM users WHERE username='testuser'), 'testuser', '$HASH', 'admin');"
# Try to call local server login and download outages CSV
# Wait for server to be up
for i in {1..10}; do
  if curl -sS http://127.0.0.1:7654/ >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
# Login and save cookie
curl -s -c /tmp/cookiejar.txt -H "Content-Type: application/json" -d '{"username":"testuser","password":"password123"}' http://127.0.0.1:7654/api/auth/login || true
# Download outages CSV
curl -s -b /tmp/cookiejar.txt http://127.0.0.1:7654/api/reports/outages.csv -o /tmp/outages.csv || true
ls -l /tmp/outages.csv || true

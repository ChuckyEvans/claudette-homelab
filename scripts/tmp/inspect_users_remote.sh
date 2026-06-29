#!/bin/bash
DB=/var/lib/docker/volumes/claudette-data/_data/claudette.db
sudo sqlite3 "$DB" "PRAGMA table_info(users);" || sudo ls -l "$DB"

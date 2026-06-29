#!/bin/bash
sudo sqlite3 /var/lib/docker/volumes/claudette-data/_data/claudette.db "PRAGMA table_info(users);"

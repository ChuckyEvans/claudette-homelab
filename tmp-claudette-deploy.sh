#!/bin/sh
set -e
rm -rf /tmp/claudette-build
mkdir -p /tmp/claudette-build
tar -xf /home/ubuntu/claudette-src.tar -C /tmp/claudette-build
test -f /home/ubuntu/claudette-src.tar && rm -f /home/ubuntu/claudette-src.tar
mv /tmp/claudette-Dockerfile /tmp/claudette-build/Dockerfile || true
PROGFILE=/tmp/claudette-build/progress.json
emit() { echo "$1" > "$PROGFILE" ; }
emit '{"step":"start","progress":0,"message":"begin build"}'
cd /tmp/claudette-build && sudo docker build --progress=plain --build-arg CACHEBUST=1783190335 -t claudette:latest . 2>&1 | awk -v pf=/tmp/claudette-build/progress.json '/Step/ { cmd=$0 } /Downloading|Downloading from/ { print "{\"step\":\"fetching\",\"progress\":0.2,\"message\":\"" $0 "\"}" > pf } /Building\/SHIPPED/ { print "{\"step\":\"building\",\"progress\":0.6,\"message\":\"" $0 "\"}" > pf } { print }'
cd /
rm -rf /tmp/claudette-build

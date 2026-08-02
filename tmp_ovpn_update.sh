#!/bin/bash
set -euo pipefail
CONF=/etc/openvpn/ovpn-update.conf
if [ -f "$CONF" ]; then . "$CONF"; fi
if [ -z "${CONFIG_URL:-}" ]; then
echo "ovpn-update: CONFIG_URL not set in $CONF; exiting"
exit 0
fi
TS=$(date +%s)
TMPDIR="/tmp/ovpn_update_$TS"
mkdir -p "$TMPDIR"
ZIP="$TMPDIR/ovpn_archive.zip"
echo "ovpn-update: downloading $CONFIG_URL"
if ! curl -fsSL --retry 3 --retry-delay 5 "$CONFIG_URL" -o "$ZIP"; then
  echo "ovpn-update: download failed" >&2
  rm -rf "$TMPDIR"
  exit 1
fi
EXTRACT="$TMPDIR/extract"
mkdir -p "$EXTRACT"
case "$ZIP" in
  *.zip) unzip -q "$ZIP" -d "$EXTRACT" ;;
  *.tar.gz|*.tgz) tar -xzf "$ZIP" -C "$EXTRACT" ;;
  *) echo "ovpn-update: unknown archive format, trying unzip" && unzip -q "$ZIP" -d "$EXTRACT" || true ;;
esac
NEWDIR="/etc/openvpn/ovpn_tcp_new_$TS"
mkdir -p "$NEWDIR"
find "$EXTRACT" -type f -name '*.ovpn' -exec cp -a -- '{}' "$NEWDIR/" \;
if [ $(find "$NEWDIR" -maxdepth 1 -type f -name '*.ovpn' | wc -l) -eq 0 ]; then
  echo "ovpn-update: no .ovpn files found in archive" >&2
  rm -rf "$TMPDIR"
  exit 1
fi
BACKUP_DIR="/root/ovpn-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -d /etc/openvpn/ovpn_tcp ]; then
  echo "ovpn-update: backing up existing /etc/openvpn/ovpn_tcp -> $BACKUP_DIR"
  cp -a /etc/openvpn/ovpn_tcp "$BACKUP_DIR/" || true
  mv /etc/openvpn/ovpn_tcp "/etc/openvpn/ovpn_tcp.old.$TS" || true
fi
mv "$NEWDIR" /etc/openvpn/ovpn_tcp
chown -R root:root /etc/openvpn/ovpn_tcp
chmod -R 644 /etc/openvpn/ovpn_tcp/*.ovpn || true
rm -rf "$TMPDIR"
echo "ovpn-update: updated /etc/openvpn/ovpn_tcp with $(ls -1 /etc/openvpn/ovpn_tcp | wc -l) files"
exit 0

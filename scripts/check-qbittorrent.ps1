param(
  [string]$sshTarget,
  [string]$url = 'http://192.168.8.10:8082'
)

Write-Host "Checking qBittorrent UI at: $url"
try {
  $r = curl -UseBasicParsing -Uri $url -Method Head -TimeoutSec 5 -ErrorAction Stop
  Write-Host "[OK] $url responded: $($r.StatusCode)"
} catch {
  Write-Warning "$url did not respond to HTTP HEAD request: $($_.Exception.Message)"
}

if ($sshTarget) {
  Write-Host "`nRunning remote diagnostics on $sshTarget (requires SSH access)"
  $script = @'
echo "--- systemctl status (qbittorrent) ---"
sudo systemctl status qbittorrent-nox --no-pager || sudo systemctl status qbittorrent.service --no-pager || ps aux | grep -i qbittorrent | grep -v grep || true
echo
echo "--- listening ports (8082) ---"
sudo ss -ltnp 2>/dev/null | grep ':8082' || sudo netstat -ltnp 2>/dev/null | grep ':8082' || echo "no listener on 8082"
echo
echo "--- recent journal (qbittorrent) ---"
sudo journalctl -u qbittorrent-nox -n 120 --no-pager 2>/dev/null || sudo journalctl -u qbittorrent.service -n 120 --no-pager 2>/dev/null || true
'@

  ssh $sshTarget $script
}

Write-Host "`nDone. If UI is unreachable but service is running, check firewall (ufw) and qBittorrent bind address in its config." 

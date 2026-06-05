# scripts/windows/deploy-pi.ps1
# Deploy Claudette to the Raspberry Pi from Windows.
# Uploads the project source to the Pi and builds the Docker image natively — no cross-compilation needed.
#
# Cross-platform alternative (Windows / macOS / Linux):
#   npm run deploy                   # full deploy
#   npm run deploy -- --quick        # sync server/ only
#   npm run deploy -- --pre-built    # skip npm build on Pi
#   node scripts/deploy-pi.mjs --help
#
# Requirements: OpenSSH client + scp (built into Windows 10+), Docker installed on the Pi.
#
# Usage (from repo root):
#   .\scripts\windows\deploy-pi.ps1                          # full deploy: upload source, build on Pi, restart container
#   .\scripts\windows\deploy-pi.ps1 -Quick                   # fast path: sync server/ files only, restart container (~5s)
#   .\scripts\windows\deploy-pi.ps1 -SkipBuild               # skip Docker build, restart using existing image on Pi
#   .\scripts\windows\deploy-pi.ps1 -PreBuilt                # ship local dist/ to Pi — skips npm build on Pi (~2x faster)
#   .\scripts\windows\deploy-pi.ps1 -PiHost 192.168.1.50     # override Pi host
#
param(
    [string]$PiHost    = '',   # override Pi IP / hostname
    [string]$PiUser    = '',   # override SSH user
    [string]$SshKey    = '',   # override SSH key path
    [switch]$SkipBuild,        # skip image rebuild, re-use existing image already on the Pi
    [switch]$PreBuilt,         # ship local dist/ to Pi, skip npm build on Pi (~2x faster Docker build)
    [switch]$Quick,            # fast path: skip Docker, just sync app files into running container
    [string]$KodiHost  = '',   # optional: deploy Kodi addon to this LibreELEC/Kodi host
    [string]$KodiUser  = 'root' # SSH user for Kodi host (LibreELEC default: root)
)

$ErrorActionPreference = 'Stop'

# Resolve project root (two levels up: scripts/windows/ -> scripts/ -> root)
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

# ── Configuration ─────────────────────────────────────────────────────────────

function Read-YamlValue([string]$key, [string]$default) {
    $configPath = Join-Path $ProjectRoot 'config.yaml'
    if (-not (Test-Path $configPath)) { return $default }
    $m = Select-String -Path $configPath -Pattern "^\s*${key}:\s*(.+)" | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'") }
    return $default
}

# Reads a YAML block-list value: lines matching "  - item" immediately following "  key:"
function Read-YamlList([string]$key) {
    $configPath = Join-Path $ProjectRoot 'config.yaml'
    if (-not (Test-Path $configPath)) { return @() }
    $lines = Get-Content $configPath
    $capturing = $false; $result = @()
    foreach ($line in $lines) {
        if ($line -match "^\s+${key}:\s*$") { $capturing = $true; continue }
        if ($capturing) {
            if ($line -match '^\s+-\s+(.+)') { $result += $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line.Trim() -and $line -notmatch '^\s+-') { break }
        }
    }
    return $result
}

if (-not $PiHost) { $PiHost = Read-YamlValue 'host'     '192.168.1.10' }
if (-not $PiUser) { $PiUser = Read-YamlValue 'ssh_user' 'ubuntu'       }
if (-not $SshKey) {
    $raw = Read-YamlValue 'ssh_key' ''
    if ($raw -and $raw -notmatch '#') {
        $SshKey = $raw -replace '^~', $env:USERPROFILE
    }
}

$ContainerName = 'claudette'
$ImageName     = 'claudette:latest'

$SshArgs = @('-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes')
if ($SshKey) { $SshArgs += @('-i', $SshKey) }

# ── Helpers ───────────────────────────────────────────────────────────────────

function Invoke-Ssh([string]$cmd) {
    ssh @SshArgs "${PiUser}@${PiHost}" $cmd
    if ($LASTEXITCODE -ne 0) { throw "SSH command failed (exit $LASTEXITCODE): $cmd" }
}

function Invoke-SshSilent([string]$cmd) {
    # Returns output without throwing on non-zero exit (for optional probes)
    ssh @SshArgs "${PiUser}@${PiHost}" $cmd 2>$null
}

# ── Main ──────────────────────────────────────────────────────────────────────

Write-Host "`nDeploying Claudette to ${PiUser}@${PiHost}" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray

# ── Quick path: sync server files only into running container ────────────────
# Skips the frontend build and Docker image rebuild entirely.
# Use this when you've only changed server/ files.
if ($Quick) {
    Write-Host "`n[1/2] Uploading server files to Pi..." -ForegroundColor Cyan
    $QuickTar = Join-Path $env:TEMP 'claudette-quick.tar'
    tar -cf $QuickTar -C $ProjectRoot server
    if ($LASTEXITCODE -ne 0) { Write-Error "tar failed."; exit 1 }
    $sizeMB = [math]::Round((Get-Item $QuickTar).Length / 1MB, 1)
    Write-Host "      Tarball: ${sizeMB} MB" -ForegroundColor DarkGray
    scp @SshArgs $QuickTar "${PiUser}@${PiHost}:/tmp/claudette-quick.tar"
    if ($LASTEXITCODE -ne 0) { Write-Error "scp failed."; exit 1 }
    Remove-Item $QuickTar -Force
    Write-Host "      Uploaded." -ForegroundColor Green

    Write-Host "`n[2/2] Installing files + restarting container..." -ForegroundColor Cyan
    Invoke-Ssh "sudo docker cp /tmp/claudette-quick.tar ${ContainerName}:/tmp/claudette-quick.tar && sudo docker exec ${ContainerName} sh -c 'cd /app && tar xf /tmp/claudette-quick.tar && rm /tmp/claudette-quick.tar' && rm /tmp/claudette-quick.tar && sudo docker restart ${ContainerName}"
    Write-Host "      Done." -ForegroundColor Green

    Write-Host "`nClaudette is running at http://${PiHost}:7654" -ForegroundColor Green
    Write-Host "Logs: ssh ${PiUser}@${PiHost} 'docker logs -f ${ContainerName}'`n" -ForegroundColor DarkGray
    exit 0
}

# ── 1a. PreBuilt path: ship local dist/ and build image without npm build on Pi ──
if ($PreBuilt) {
    Write-Host "`n[1/2] Uploading pre-built dist + server (skipping npm build on Pi)..." -ForegroundColor Cyan
    $SrcTar  = Join-Path $env:TEMP 'claudette-src.tar'
    $include = @('server','dist','package.json','package-lock.json')
    $existing = $include | Where-Object { Test-Path (Join-Path $ProjectRoot $_) }
    tar -cf $SrcTar -C $ProjectRoot @existing
    if ($LASTEXITCODE -ne 0) { Write-Error "tar failed."; exit 1 }
    $sizeMB = [math]::Round((Get-Item $SrcTar).Length / 1MB, 1)
    Write-Host "      Tarball: ${sizeMB} MB" -ForegroundColor DarkGray
    scp @SshArgs $SrcTar "${PiUser}@${PiHost}:/tmp/claudette-src.tar"
    if ($LASTEXITCODE -ne 0) { Write-Error "scp failed."; exit 1 }
    Remove-Item $SrcTar -Force
    Write-Host "      Uploaded. Building on Pi (no npm build)..." -ForegroundColor DarkGray
    $CacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    # Write an inline Dockerfile to a temp file and ship it alongside the tarball
    $inlineDockerfile = @'
FROM node:22-alpine
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && apk add --no-cache nmap nmap-scripts tcpdump curl traceroute mtr
WORKDIR /app
COPY package*.json ./
RUN echo 'nameserver 8.8.8.8' > /etc/resolv.conf && npm ci --omit=dev
ARG CACHEBUST=1
RUN echo "cachebust=$CACHEBUST"
COPY server/ ./server/
COPY dist/ ./dist/
RUN mkdir -p /app/data
EXPOSE 7654
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
'@
    $tmpDockerfile = Join-Path $env:TEMP 'claudette-Dockerfile'
    [System.IO.File]::WriteAllText($tmpDockerfile, $inlineDockerfile)
    scp @SshArgs $tmpDockerfile "${PiUser}@${PiHost}:/tmp/claudette-Dockerfile"
    if ($LASTEXITCODE -ne 0) { Write-Error "scp Dockerfile failed."; exit 1 }
    Remove-Item $tmpDockerfile -Force
    Invoke-Ssh "rm -rf /tmp/claudette-build && mkdir -p /tmp/claudette-build && tar -xf /tmp/claudette-src.tar -C /tmp/claudette-build && rm /tmp/claudette-src.tar && mv /tmp/claudette-Dockerfile /tmp/claudette-build/Dockerfile && cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=$CacheBust -t claudette:latest . && cd / && rm -rf /tmp/claudette-build"
    Write-Host "      Built." -ForegroundColor Green
}

# ── 1. Upload source + build on Pi ───────────────────────────────────────────
elseif (-not $SkipBuild) {
    Write-Host "`n[1/2] Uploading source + building on Pi (native ARM64)..." -ForegroundColor Cyan
    $SrcTar  = Join-Path $env:TEMP 'claudette-src.tar'
    $include = @('server','src','public','package.json','package-lock.json','Dockerfile',
                 'vite.config.js','postcss.config.js','tailwind.config.js','index.html',
                 'eslint.config.js','.dockerignore')
    $existing = $include | Where-Object { Test-Path (Join-Path $ProjectRoot $_) }
    tar -cf $SrcTar -C $ProjectRoot @existing
    if ($LASTEXITCODE -ne 0) { Write-Error "tar failed."; exit 1 }
    $sizeMB = [math]::Round((Get-Item $SrcTar).Length / 1MB, 1)
    Write-Host "      Tarball: ${sizeMB} MB" -ForegroundColor DarkGray
    scp @SshArgs $SrcTar "${PiUser}@${PiHost}:/tmp/claudette-src.tar"
    if ($LASTEXITCODE -ne 0) { Write-Error "scp failed."; exit 1 }
    Remove-Item $SrcTar -Force
    Write-Host "      Uploaded. Building on Pi (this takes a few minutes)..." -ForegroundColor DarkGray
    $CacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Invoke-Ssh "rm -rf /tmp/claudette-build && mkdir -p /tmp/claudette-build && tar -xf /tmp/claudette-src.tar -C /tmp/claudette-build && rm /tmp/claudette-src.tar && cd /tmp/claudette-build && sudo docker build --build-arg CACHEBUST=$CacheBust -t claudette:latest . && cd / && rm -rf /tmp/claudette-build"
    Write-Host "      Built." -ForegroundColor Green
} else {
    Write-Host "`n[1/2] Skipping build — reusing existing image on Pi." -ForegroundColor DarkGray
} # end elseif -not $SkipBuild

# ── 2. Restart container on Pi ────────────────────────────────────────────────
Write-Host "`n[2/2] Restarting container on Pi..." -ForegroundColor Cyan

Invoke-Ssh "sudo docker stop ${ContainerName} 2>/dev/null || true"
Invoke-Ssh "sudo docker rm   ${ContainerName} 2>/dev/null || true"

# Probe for a DHCP leases file and mount it if present (dnsmasq)
$leasesMount = ''
$leasesPath  = Invoke-SshSilent "ls /etc/pihole/dhcp.leases /var/lib/misc/dnsmasq.leases 2>/dev/null | head -1"
if ($leasesPath -and $leasesPath.Trim()) {
    $leasesMount = "-v $($leasesPath.Trim()):/data/dhcp.leases:ro"
    Write-Host "      DHCP leases: $($leasesPath.Trim()) will be mounted." -ForegroundColor DarkGray
} else {
    Write-Host "      No DHCP leases file found — hostnames from DNS only." -ForegroundColor DarkGray
}

# Read the host's DNS servers so the container resolves local .home names
# (Docker overrides with 1.1.1.1 by default when host uses private-IP nameservers)
$dnsFlags = @()
$hostDns = Invoke-SshSilent "grep '^nameserver' /etc/resolv.conf | sed 's/nameserver //' | head -3"
foreach ($ns in ($hostDns -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    $dnsFlags += "--dns $ns"
    Write-Host "      DNS: using $ns from host resolv.conf" -ForegroundColor DarkGray
}
# Append fallback DNS from config.yaml (used if the primary DNS resolver is down)
$fallbackDns = Read-YamlList 'fallback_dns'
foreach ($dns in $fallbackDns) {
    if ($dns -match '^[0-9a-fA-F.:]+$') {
        $dnsFlags += "--dns $dns"
        Write-Host "      DNS fallback: $dns (from config.yaml)" -ForegroundColor DarkGray
    }
}

Invoke-Ssh (@(
    "sudo docker run -d",
    "--init",
    "--name $ContainerName",
    "--restart unless-stopped",
    "--cap-add NET_ADMIN",
    "--cap-add NET_RAW",
    "--network host",
    ($dnsFlags -join ' '),
    $leasesMount,
    "-v claudette-data:/app/data",
    $ImageName
) -join ' ')

Write-Host "      Container started." -ForegroundColor Green
Write-Host "`nClaudette is running at http://${PiHost}:7654" -ForegroundColor Green
Write-Host "Logs: ssh ${PiUser}@${PiHost} 'docker logs -f ${ContainerName}'`n" -ForegroundColor DarkGray

# ── 5. Deploy Kodi addon (optional) ──────────────────────────────────────────────
if ($KodiHost) {
    Write-Host "`n[3/3] Deploying Kodi addon to ${KodiUser}@${KodiHost}..." -ForegroundColor Cyan
    $KodiSshArgs = @('-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes')
    if ($SshKey) { $KodiSshArgs += @('-i', $SshKey) }
    $AddonSrc  = Join-Path $ProjectRoot 'output\kodi\plugin.program.claudette'
    $AddonDest = '/storage/.kodi/addons/'
    scp @KodiSshArgs -r $AddonSrc "${KodiUser}@${KodiHost}:${AddonDest}"
    if ($LASTEXITCODE -ne 0) { Write-Warning "Kodi scp failed — addon not deployed."; }
    else {
        # Reload Kodi addons without restarting
        ssh @KodiSshArgs "${KodiUser}@${KodiHost}" 'kodi-send --action="UpdateLocalAddons" 2>/dev/null || true' 2>$null
        Write-Host "      Kodi addon deployed. In Kodi: Settings → Add-ons → My Add-ons → Program add-ons → Claudette" -ForegroundColor Green
    }
}

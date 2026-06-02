# build-addon.ps1
# Packages the Claudette Kodi addon into a distributable zip.
#
# Usage:
#   .\build-addon.ps1                                  # build zip only
#   .\build-addon.ps1 -KodiHost 192.168.8.250          # build + deploy via Pi hop
#   .\build-addon.ps1 -KodiHost 192.168.8.250 -Quick   # skip zip — rsync files directly (~5s)
#   .\build-addon.ps1 -KodiHost 192.168.8.250 -PiHost 192.168.8.10
#
param(
    [string]$KodiHost  = '',
    [string]$KodiUser  = 'root',
    [string]$SshKey    = '',
    [string]$PiHost    = '192.168.8.10',
    [string]$PiUser    = 'ubuntu',
    [switch]$Quick                 # Skip zip build — copy files directly via SCP (no Kodi restart needed for Python changes)
)

$ErrorActionPreference = 'Stop'
$AddonDir  = Join-Path $PSScriptRoot 'plugin.program.claudette'
$AddonXml  = Join-Path $AddonDir 'addon.xml'

if (-not (Test-Path $AddonXml)) {
    Write-Error "addon.xml not found at $AddonXml"
    exit 1
}

# Read version from addon.xml
$xml     = [xml](Get-Content $AddonXml -Raw)
$version = $xml.addon.version
$zipName = "plugin.program.claudette-${version}.zip"
$zipPath = Join-Path $PSScriptRoot $zipName

$SshArgs = @('-o', 'StrictHostKeyChecking=no')
if ($SshKey) { $SshArgs += @('-i', $SshKey) }

# ── Quick mode: skip zip, SCP files directly ─────────────────────────────────
if ($Quick) {
    if (-not $KodiHost) { Write-Error "-Quick requires -KodiHost"; exit 1 }
    Write-Host "Quick-deploying addon files to ${KodiUser}@${KodiHost} via Pi hop..." -ForegroundColor Cyan

    # Stage files on Pi then push to LibreELEC
    $dest = '/storage/.kodi/addons/plugin.program.claudette'
    scp @SshArgs -r "$AddonDir" "${PiUser}@${PiHost}:/tmp/plugin.program.claudette"
    if ($LASTEXITCODE -ne 0) { Write-Warning "scp to Pi failed."; exit 1 }

    $remote = "sshpass -p libreelec scp -o StrictHostKeyChecking=no -r /tmp/plugin.program.claudette ${KodiUser}@${KodiHost}:/storage/.kodi/addons/ && " +
              "rm -rf /tmp/plugin.program.claudette"
    ssh @SshArgs "${PiUser}@${PiHost}" $remote
    if ($LASTEXITCODE -ne 0) { Write-Warning "SCP to LibreELEC failed."; exit 1 }

    Write-Host "  Files updated. Kodi will pick up Python changes on next addon launch." -ForegroundColor Green
    Write-Host "`nDone." -ForegroundColor Green
    exit 0
}

Write-Host "Building Claudette Kodi addon v${version}..." -ForegroundColor Cyan

# ── Regenerate icon.png from project favicon.svg ─────────────────────────────
$iconPath  = Join-Path $AddonDir 'icon.png'
$faviconPath = Join-Path $PSScriptRoot '..\..\public\favicon.svg'
if (Test-Path $faviconPath) {
    Write-Host "  Regenerating icon.png from favicon.svg..." -ForegroundColor Gray
    try {
        $job = Start-Job { npx --yes svgexport $using:faviconPath $using:iconPath '256:256' }
        $done = Wait-Job $job -Timeout 20
        if ($done -and (Test-Path $iconPath)) {
            Write-Host "  icon.png updated." -ForegroundColor Gray
        } else {
            Stop-Job $job -ErrorAction SilentlyContinue
            Write-Host "  svgexport skipped (timed out or failed) — using existing icon.png" -ForegroundColor Yellow
        }
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "  svgexport failed — using existing icon.png if present" -ForegroundColor Yellow
    }
}

# Remove old zip if present
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Zip: the archive root must contain plugin.program.claudette/ (standard Kodi layout)
Push-Location $PSScriptRoot
try {
    Compress-Archive -Path 'plugin.program.claudette' -DestinationPath $zipPath
} finally {
    Pop-Location
}

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "  Built: $zipName ($size KB)" -ForegroundColor Green

# Optional: deploy to Kodi host — hops via Pi using sshpass (LibreELEC default creds)
if ($KodiHost) {
    Write-Host "`nDeploying to ${KodiUser}@${KodiHost} via Pi hop..." -ForegroundColor Cyan

    # 1. Stage zip on Pi
    scp @SshArgs $zipPath "${PiUser}@${PiHost}:/tmp/"
    if ($LASTEXITCODE -ne 0) { Write-Warning "scp to Pi failed."; return }

    # 2. Pi → LibreELEC: copy zip, extract, restart Kodi
    $remote = "sshpass -p libreelec scp -o StrictHostKeyChecking=no /tmp/$zipName ${KodiUser}@${KodiHost}:/storage/.kodi/addons/ && " +
              "sshpass -p libreelec ssh -o StrictHostKeyChecking=no ${KodiUser}@${KodiHost} " +
              "'cd /storage/.kodi/addons && unzip -o $zipName && rm $zipName && systemctl restart kodi'"
    ssh @SshArgs "${PiUser}@${PiHost}" $remote
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Deploy to LibreELEC failed."
    } else {
        Write-Host "  Deployed and Kodi restarted." -ForegroundColor Green
    }
}

Write-Host "`nDone." -ForegroundColor Green

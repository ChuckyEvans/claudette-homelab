# build-addon.ps1
# Packages the Claudette Kodi addon into a distributable zip.
#
# Usage:
#   .\build-addon.ps1                                  # build zip only
#   .\build-addon.ps1 -KodiHost 192.168.8.250          # build + deploy via Pi hop
#   .\build-addon.ps1 -KodiHost 192.168.8.250 -PiHost 192.168.8.10
#
param(
    [string]$KodiHost  = '',
    [string]$KodiUser  = 'root',
    [string]$SshKey    = '',
    [string]$PiHost    = '192.168.8.10',
    [string]$PiUser    = 'ubuntu'
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

Write-Host "Building Claudette Kodi addon v${version}..." -ForegroundColor Cyan

# ── Regenerate icon.png from project favicon.svg ─────────────────────────────
$iconPath  = Join-Path $AddonDir 'icon.png'
$faviconPath = Join-Path $PSScriptRoot '..\..\public\favicon.svg'
if (Test-Path $faviconPath) {
    Write-Host "  Regenerating icon.png from favicon.svg..." -ForegroundColor Gray
    try {
        npx --yes svgexport $faviconPath $iconPath '256:256' 2>&1 | Out-Null
        if (Test-Path $iconPath) {
            Write-Host "  icon.png updated." -ForegroundColor Gray
        }
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
    $SshArgs = @('-o', 'StrictHostKeyChecking=no')
    if ($SshKey) { $SshArgs += @('-i', $SshKey) }

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

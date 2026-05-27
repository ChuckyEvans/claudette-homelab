# scripts/windows/restart.ps1
# Build and run Claudette locally using Docker on Windows.
#
# Requirements: Docker Desktop
#
# Usage (from repo root):
#   .\deploy-win.ps1               # full build + restart
#   .\deploy-win.ps1 -SkipBuild    # restart without rebuilding the image
#
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ImageName     = 'claudette:latest'
$ContainerName = 'claudette'

# Resolve project root (two levels up: scripts/windows/ -> scripts/ -> root)
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

Write-Host "`nDeploying Claudette locally (Windows / Docker)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray

# ── 1. Stop and remove existing container ────────────────────────────────────
Write-Host "`n[1/3] Stopping existing container..." -ForegroundColor Cyan
$existing = docker ps -aq --filter "name=^${ContainerName}$" 2>$null
if ($existing) {
    docker stop $ContainerName | Out-Null
    docker rm   $ContainerName | Out-Null
    Write-Host "      Stopped and removed '$ContainerName'." -ForegroundColor Green
} else {
    Write-Host "      No running container found, skipping." -ForegroundColor DarkGray
}

# ── 2. Build image ────────────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Host "`n[2/3] Building image '$ImageName'..." -ForegroundColor Cyan
    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) { Write-Error "Docker build failed (exit $LASTEXITCODE)."; exit 1 }
    Write-Host "      Build successful." -ForegroundColor Green
} else {
    Write-Host "`n[2/3] Skipping build (-SkipBuild flag set)." -ForegroundColor DarkGray
}

# ── 3. Start container ────────────────────────────────────────────────────────
Write-Host "`n[3/3] Starting container '$ContainerName'..." -ForegroundColor Cyan

& docker run -d `
    --name      $ContainerName `
    --restart   unless-stopped `
    --cap-add   NET_ADMIN `
    --cap-add   NET_RAW `
    -p          7654:7654 `
    -v          claudette-data:/app/data `
    $ImageName

if ($LASTEXITCODE -ne 0) { Write-Error "docker run failed (exit $LASTEXITCODE)."; exit 1 }

Write-Host "`nClaudette is running at http://localhost:7654" -ForegroundColor Green
Write-Host "Logs: docker logs -f $ContainerName`n" -ForegroundColor DarkGray

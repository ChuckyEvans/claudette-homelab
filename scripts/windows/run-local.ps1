# scripts/windows/run-local.ps1
# Run Claudette natively on Windows — no Docker required.
# Network scanning works in full because nmap runs directly on the host NIC,
# bypassing the Docker Desktop VM that blocks raw sockets.
#
# Requirements:
#   Node.js 20+   https://nodejs.org
#   nmap + Npcap  winget install Insecure.Nmap
#                 (Npcap is bundled — enables raw-socket scanning on Windows)
#
# Usage (run from repo root, or this script handles cd automatically):
#   .\scripts\windows\run-local.ps1           # hot-reload dev server
#   .\scripts\windows\run-local.ps1 -Prod     # build + run production server
#   .\scripts\windows\run-local.ps1 -Stop     # stop a running background server

param(
    [switch]$Prod,   # build and start in production mode
    [switch]$Stop    # stop the running dev/prod server
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

# ── Stop mode ────────────────────────────────────────────────────────────────
if ($Stop) {
    $procs = Get-Process -Name 'node' -ErrorAction SilentlyContinue
    if ($procs) {
        $procs | Stop-Process -Force
        Write-Host "Stopped all Node.js processes." -ForegroundColor Green
    } else {
        Write-Host "No Node.js process found." -ForegroundColor DarkGray
    }
    exit 0
}

Write-Host "`nRunning Claudette locally (Windows / Node.js)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────" -ForegroundColor DarkGray

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
Write-Host "`n[1/4] Checking Node.js..." -ForegroundColor Cyan
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "  ERROR: Node.js not found." -ForegroundColor Red
    Write-Host "         Install v20+ from https://nodejs.org then rerun this script." -ForegroundColor Red
    exit 1
}
$nodeVer = node --version 2>$null
Write-Host "  OK  $nodeVer" -ForegroundColor Green

# ── 2. Check nmap ─────────────────────────────────────────────────────────────
Write-Host "`n[2/4] Checking nmap..." -ForegroundColor Cyan
$nmapCmd = Get-Command nmap -ErrorAction SilentlyContinue
if ($nmapCmd) {
    $nmapVer = (nmap --version 2>$null | Select-Object -First 1)
    Write-Host "  OK  $nmapVer" -ForegroundColor Green
} else {
    Write-Host "  WARN: nmap not found — network scanning will be unavailable." -ForegroundColor Yellow
    Write-Host "        Install nmap + Npcap (required for raw-socket scanning):" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "          winget install Insecure.Nmap" -ForegroundColor White
    Write-Host ""
    Write-Host "        Then restart this script." -ForegroundColor Yellow
}

# ── 3. Install dependencies ───────────────────────────────────────────────────
Write-Host "`n[3/4] Installing dependencies..." -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
    npm install
} else {
    npm install --prefer-offline
}
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed."; exit 1 }
Write-Host "  OK" -ForegroundColor Green

# ── 4. Config ─────────────────────────────────────────────────────────────────
if (-not (Test-Path 'config.yaml')) {
    Copy-Item 'config.example.yaml' 'config.yaml'
    Write-Host "`n  Created config.yaml from template." -ForegroundColor Yellow
    Write-Host "  Edit it before using (subnet, services, ISP details)." -ForegroundColor Yellow
}

# ── 5. Start ──────────────────────────────────────────────────────────────────
if ($Prod) {
    Write-Host "`n[4/4] Building and starting production server..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }
    $env:NODE_ENV = 'production'
    Write-Host "`n  Open http://localhost:7654`n" -ForegroundColor Green
    node server/index.js
} else {
    Write-Host "`n[4/4] Starting dev server (hot-reload)..." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  UI  → http://localhost:5173  (hot-reload)" -ForegroundColor Green
    Write-Host "  API → http://localhost:7654`n" -ForegroundColor DarkGray
    npm run dev
}

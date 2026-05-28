# deploy-win.ps1 — Windows entry point. Full script lives in scripts/windows/restart.ps1
#
# Builds and runs Claudette locally using Docker Desktop on Windows.
# Use this when you want to run the app on this machine, not on the Pi.
#
# Usage:
#   .\deploy-win.ps1               # full build + restart
#   .\deploy-win.ps1 -SkipBuild    # restart container without rebuilding the image
#
# Pi deployment: use .\deploy-pi.ps1 instead
# Linux / macOS: use scripts/linux/restart.sh instead
#
param(
    [switch]$SkipBuild
)

& "$PSScriptRoot\scripts\windows\restart.ps1" @PSBoundParameters
exit $LASTEXITCODE

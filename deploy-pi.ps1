# deploy-pi.ps1 — Windows entry point. Full script lives in scripts/windows/deploy-pi.ps1
#
# Usage:
#   .\deploy-pi.ps1                          # full build + deploy (reads config.yaml)
#   .\deploy-pi.ps1 -Quick                   # fast path: build frontend, sync files, restart (~8s)
#   .\deploy-pi.ps1 -SkipBuild               # re-use last claudette-arm64.tar
#   .\deploy-pi.ps1 -PiHost 192.168.1.50     # override host from config
#   .\deploy-pi.ps1 -KodiHost 192.168.1.51   # also deploy Kodi addon to this host
#
# Linux / macOS: use scripts/linux/deploy-pi.sh instead
#
param(
    [string]$PiHost    = '',
    [string]$PiUser    = '',
    [string]$SshKey    = '',
    [switch]$SkipBuild,
    [switch]$Quick,
    [string]$KodiHost  = '',
    [string]$KodiUser  = 'root'
)

# Forward all bound parameters explicitly via a hashtable splat so switches
# like -SkipBuild/-Quick are not silently dropped by PowerShell's argument binding.
$splat = @{ PiHost = $PiHost; PiUser = $PiUser; SshKey = $SshKey; KodiHost = $KodiHost; KodiUser = $KodiUser }
if ($SkipBuild) { $splat.SkipBuild = $true }
if ($Quick)     { $splat.Quick     = $true }
& "$PSScriptRoot\scripts\windows\deploy-pi.ps1" @splat
exit $LASTEXITCODE

param(
    $KodiIp   = "192.168.8.250",
    $KodiPass = "Thecat1@",
    $ClaudetteUrl  = "http://192.168.8.10:7654",
    $ClaudetteUser = "",   # filled in below via prompt if empty
    $ClaudettePass = ""
)

$cred = [Net.NetworkCredential]::new("kodi", $KodiPass)

function KodiRpc($method, $params = @{}) {
    $body = [Text.Encoding]::UTF8.GetBytes(
        (ConvertTo-Json -Compress -Depth 10 @{ jsonrpc="2.0"; method=$method; params=$params; id=1 })
    )
    $r = [Net.WebRequest]::Create("http://${KodiIp}:8080/jsonrpc")
    $r.Method="POST"; $r.ContentType="application/json"
    $r.ContentLength=$body.Length; $r.Credentials=$cred
    $s=$r.GetRequestStream(); $s.Write($body,0,$body.Length); $s.Close()
    try {
        $resp=$r.GetResponse()
        return ConvertFrom-Json ([IO.StreamReader]::new($resp.GetResponseStream()).ReadToEnd())
    } catch [Net.WebException] {
        $code = [int]$_.Exception.Response.StatusCode
        Write-Host "  HTTP $code" -ForegroundColor Red; return $null
    }
}

function KodiDownload($path) {
    $prep = KodiRpc "Files.PrepareDownload" @{ path = $path }
    if (-not $prep.result) { return $null }
    $dlPath = $prep.result.details.path
    $url = "http://${KodiIp}:8080/$dlPath"
    try {
        $wc = [Net.WebClient]::new(); $wc.Credentials = $cred
        return $wc.DownloadString($url)
    } catch { return $null }
}

# ── 1. Read existing addon settings if present ───────────────────────────────
Write-Host "`n[1] Checking Claudette addon settings..." -ForegroundColor Cyan
$settingsPath = "special://masterprofile/addon_data/plugin.program.claudette/settings.xml"
$existing = KodiDownload $settingsPath
if ($existing) {
    Write-Host "  Existing settings.xml:" -ForegroundColor Yellow
    Write-Host $existing
} else {
    Write-Host "  No existing settings.xml (will create defaults)" -ForegroundColor Gray
}

# Prompt for Claudette credentials if not passed
if (-not $ClaudetteUser) {
    $ClaudetteUser = Read-Host "  Claudette username"
}
if (-not $ClaudettePass) {
    $ClaudettePass = Read-Host "  Claudette password"
}

# ── 2. Write settings.xml via Kodi VFS ──────────────────────────────────────
Write-Host "`n[2] Writing addon settings via Kodi..." -ForegroundColor Cyan

$xml = @"
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<settings version="2">
  <setting id="server_url" value="$ClaudetteUrl"/>
  <setting id="username" value="$ClaudetteUser"/>
  <setting id="password" value="$ClaudettePass"/>
  <setting id="timeout" value="10"/>
  <setting id="show_offline_devices" value="true"/>
  <setting id="threat_min_severity" value="1"/>
  <setting id="audit_limit" value="50"/>
</settings>
"@

# ── 2. Write settings.xml via SSH ───────────────────────────────────────────
Write-Host "`n[2] Writing addon settings via SSH..." -ForegroundColor Cyan

$SshPass = "libreelec"
$SshHost = "root@$($KodiIp)"
$remoteDir  = "/storage/.kodi/userdata/addon_data/plugin.program.claudette"
$remotePath = "$remoteDir/settings.xml"

# Escape for sh echo
$xmlEscaped = $xml -replace "'", "'\'''"
$mkdirCmd   = "mkdir -p $remoteDir"
$writeCmd   = "printf '%s' '$xmlEscaped' > $remotePath"

$mk = plink -ssh -pw $SshPass -batch $SshHost $mkdirCmd 2>&1
$wr = plink -ssh -pw $SshPass -batch $SshHost $writeCmd 2>&1
$check = plink -ssh -pw $SshPass -batch $SshHost "cat $remotePath" 2>&1

if ($check -match 'server_url') {
    Write-Host "  settings.xml written successfully" -ForegroundColor Green
} else {
    Write-Host "  SSH write may have failed. Output:" -ForegroundColor Red
    Write-Host $check
}

# ── 3. Verify addon is enabled and reload ───────────────────────────────────
Write-Host "`n[3] Verifying addon status..." -ForegroundColor Cyan
$r = KodiRpc "Addons.GetAddonDetails" @{ addonid="plugin.program.claudette"; properties=@("enabled","version") }
$addon = $r.result.addon
Write-Host "  plugin.program.claudette v$($addon.version) enabled=$($addon.enabled)" -ForegroundColor $(if($addon.enabled){"Green"}else{"Red"})

if (-not $addon.enabled) {
    Write-Host "  Enabling addon..." -ForegroundColor Yellow
    KodiRpc "Addons.SetAddonEnabled" @{ addonid="plugin.program.claudette"; enabled=$true } | Out-Null
    Write-Host "  Enabled." -ForegroundColor Green
}

# ── 4. Check VPN manager ─────────────────────────────────────────────────────
Write-Host "`n[4] Checking VPN manager..." -ForegroundColor Cyan
$vpn = KodiRpc "Addons.GetAddonDetails" @{ addonid="service.vpn.manager"; properties=@("enabled","version","broken") }
$vpnAddon = $vpn.result.addon
if ($vpnAddon) {
    Write-Host "  service.vpn.manager v$($vpnAddon.version) enabled=$($vpnAddon.enabled) broken=$($vpnAddon.broken)" -ForegroundColor $(if($vpnAddon.enabled){"Yellow"}else{"Red"})
}

# ── 5. Grab Kodi log ─────────────────────────────────────────────────────────
Write-Host "`n[5] Downloading kodi.log for crash analysis..." -ForegroundColor Cyan
$log = KodiDownload "special://logpath/kodi.log"
if ($log) {
    $logLines = $log -split "`n"
    Write-Host "  Log lines: $($logLines.Count)" -ForegroundColor Gray
    # Find errors, crashes, segfaults, OOM
    $interesting = $logLines | Where-Object { $_ -match "ERROR|FATAL|Segmentation|killed|oom|crash|reboot|vpn|openvpn|nord" }
    Write-Host "`n  --- Notable log entries ---" -ForegroundColor Yellow
    $interesting | Select-Object -Last 40 | ForEach-Object { Write-Host "  $_" }
    $log | Out-File "$env:TEMP\kodi.log" -Encoding utf8
    Write-Host "`n  Full log saved to: $env:TEMP\kodi.log" -ForegroundColor Gray
} else {
    Write-Host "  Could not download kodi.log" -ForegroundColor Red
}

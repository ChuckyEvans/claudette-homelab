param(
    $KodiIp   = "192.168.8.250",
    $KodiPass = "Thecat1@",
    $ZipPath  = "$PSScriptRoot\plugin.program.claudette-1.0.0.zip"
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
        return ConvertFrom-Json ([IO.StreamReader]::new($r.GetResponse().GetResponseStream()).ReadToEnd())
    } catch [Net.WebException] {
        Write-Host "  HTTP $([int]$_.Exception.Response.StatusCode)" -ForegroundColor Red; return $null
    }
}

if (-not (Test-Path $ZipPath)) { Write-Error "Zip not found: $ZipPath"; exit 1 }
$zip = Get-Item $ZipPath

# ── 1. Upload zip via Kodi VFS ──────────────────────────────────────────────
Write-Host "[1] Uploading $($zip.Name) ($([math]::Round($zip.Length/1KB,1)) KB)..." -ForegroundColor Cyan
$uploadUrl = "http://${KodiIp}:8080/vfs/special%3A%2F%2Ftemp%2F$($zip.Name)"
$wc = [Net.WebClient]::new(); $wc.Credentials = $cred
try {
    $wc.UploadFile($uploadUrl, "PUT", $ZipPath) | Out-Null
    Write-Host "  Uploaded to special://temp/$($zip.Name)" -ForegroundColor Green
} catch {
    Write-Host "  VFS upload failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Trying addons/install fallback..." -ForegroundColor Yellow
}

# ── 2. Install addon from zip ────────────────────────────────────────────────
Write-Host "[2] Installing addon from zip..." -ForegroundColor Cyan
$r = KodiRpc "Addons.InstallAddon" @{ addonid="plugin.program.claudette" }

# Kodi 21 uses Files.PrepareDownload + addon install path
# Reliable path: use the GUI install-from-zip action
$r2 = KodiRpc "Addons.InstallFromZip" @{ path="special://temp/$($zip.Name)" }
if ($r2 -and -not $r2.error) {
    Write-Host "  Installed." -ForegroundColor Green
} else {
    # Try GUI navigate to install-from-zip  
    Write-Host "  Direct install returned: $(ConvertTo-Json $r2 -Compress)" -ForegroundColor Yellow
    Write-Host "  Trying GUI navigate to zip installer..." -ForegroundColor Yellow
    KodiRpc "GUI.ActivateWindow" @{ window="addonbrowser"; parameters=@("installFromZip","special://temp/$($zip.Name)") } | Out-Null
}

# ── 3. Verify ───────────────────────────────────────────────────────────────
Write-Host "[3] Verifying..." -ForegroundColor Cyan
Start-Sleep -Seconds 3
$det = KodiRpc "Addons.GetAddonDetails" @{ addonid="plugin.program.claudette"; properties=@("version","enabled","path") }
$a = $det.result.addon
if ($a) {
    Write-Host "  plugin.program.claudette v$($a.version) enabled=$($a.enabled)" -ForegroundColor Green
    Write-Host "  Path: $($a.path)"
} else {
    Write-Host "  Could not verify — check Kodi manually" -ForegroundColor Yellow
}

param($ip = "192.168.8.250", $pass = "Thecat1@")
$cred = [Net.NetworkCredential]::new("kodi", $pass)

function KodiRpc($method, $params = @{}) {
    $body = [Text.Encoding]::UTF8.GetBytes(
        (ConvertTo-Json -Compress @{ jsonrpc = "2.0"; method = $method; params = $params; id = 1 })
    )
    $r = [Net.WebRequest]::Create("http://${ip}:8080/jsonrpc")
    $r.Method = "POST"; $r.ContentType = "application/json"
    $r.ContentLength = $body.Length; $r.Credentials = $cred
    $s = $r.GetRequestStream(); $s.Write($body, 0, $body.Length); $s.Close()
    try {
        $resp = $r.GetResponse()
        $json = [IO.StreamReader]::new($resp.GetResponseStream()).ReadToEnd()
        return ConvertFrom-Json $json
    } catch [Net.WebException] {
        Write-Host "HTTP $($_.Exception.Response.StatusCode): $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# Kodi info
$info = KodiRpc "Application.GetProperties" @{ properties = @("name","version") }
if ($info) {
    $v = $info.result
    Write-Host "Kodi: $($v.name) $($v.version.major).$($v.version.minor)" -ForegroundColor Cyan
}

# Installed plugins
$addons = KodiRpc "Addons.GetAddons" @{ type = "xbmc.python.pluginsource"; properties = @("name","version","enabled") }
if ($addons.result.addons) {
    Write-Host "`nInstalled plugins:" -ForegroundColor Yellow
    $addons.result.addons | ForEach-Object { Write-Host "  $($_.addonid)  v$($_.version)  enabled=$($_.enabled)" }
} else {
    Write-Host "No plugins found (or auth failed)" -ForegroundColor Red
}

# Check Claudette specifically
$cl = KodiRpc "Addons.GetAddonDetails" @{ addonid = "plugin.program.claudette"; properties = @("name","version","enabled","path") }
if ($cl.result.addon) {
    Write-Host "`nClaudette addon:" -ForegroundColor Green
    $cl.result.addon | ConvertTo-Json
} else {
    Write-Host "`nClaudette addon: NOT installed" -ForegroundColor Red
}

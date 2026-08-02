Start-Service -Name com.docker.service -ErrorAction SilentlyContinue
Write-Host 'Requested start of com.docker.service.'

Write-Host 'Shutting down WSL to reset docker-desktop...'
wsl --shutdown
Start-Sleep -s 2

$exe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (Test-Path $exe) {
    Write-Host "Starting Docker Desktop from $exe"
    Start-Process -FilePath $exe -ErrorAction SilentlyContinue
} else {
    Write-Host "Docker Desktop exe not found at $exe"
}

Start-Sleep -s 8
Write-Host 'Checking `docker info` output...'
try {
    docker info 2>&1 | Out-String | Write-Host
} catch {
    Write-Host 'docker info failed or docker not available.'
}

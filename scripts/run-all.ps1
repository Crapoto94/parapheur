# Ouvre 3 fenêtres : backend (3004), back-office (3005), front DMZ (3006).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function Start-Window($name, $script) {
    $args = @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot $script))
    Write-Host "Démarrage $name..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList $args
}

Start-Window 'backend (3004)' 'run-backend.ps1'
Start-Sleep -Seconds 3
Start-Window 'back-office (3005)' 'run-backoffice.ps1'
Start-Window 'front DMZ (3006)' 'run-dmz.ps1'

Write-Host ''
Write-Host 'URLs :' -ForegroundColor Green
Write-Host '  API        http://localhost:3004/api/health'
Write-Host '  Back-office http://localhost:3005'
Write-Host '  Front DMZ   http://localhost:3006'

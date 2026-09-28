# Lance le front public DMZ du parapheur en local (Vite).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dmz = Join-Path $root 'frontend-dmz'
Set-Location $dmz

if (-not (Test-Path (Join-Path $dmz 'node_modules'))) {
    Write-Host 'Installation des dépendances du front DMZ...' -ForegroundColor Cyan
    npm install
}

if (-not $env:VITE_PORT) { $env:VITE_PORT = '3006' }
if (-not $env:VITE_BACKEND_URL) { $env:VITE_BACKEND_URL = 'http://127.0.0.1:3004' }

Write-Host "Front DMZ parapheur sur http://localhost:$($env:VITE_PORT) (API : $($env:VITE_BACKEND_URL))" -ForegroundColor Green
npm run dev

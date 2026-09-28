# Lance le front back-office du parapheur en local (Vite).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$front = Join-Path $root 'frontend'
Set-Location $front

if (-not (Test-Path (Join-Path $front 'node_modules'))) {
    Write-Host 'Installation des dépendances du back-office...' -ForegroundColor Cyan
    npm install
}

if (-not $env:VITE_PORT) { $env:VITE_PORT = '3005' }
if (-not $env:VITE_BACKEND_URL) { $env:VITE_BACKEND_URL = 'http://127.0.0.1:3004' }

Write-Host "Back-office parapheur sur http://localhost:$($env:VITE_PORT) (API : $($env:VITE_BACKEND_URL))" -ForegroundColor Green
npm run dev

# Lance le backend du parapheur en local (hors Docker).
# ATTENTION : il se connecte à la base PostgreSQL partagée (ivry_admin) et au
# stockage SMB/Alfresco. Le cron de relances est désactivé par défaut pour ne
# pas envoyer de vrais e-mails depuis un poste de développement.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
Set-Location $backend

$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $backend '.env.example') $envFile
    Write-Host "backend/.env créé depuis .env.example — renseignez POSTGRES_* et JWT_SECRET." -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
    Write-Host 'Installation des dépendances backend...' -ForegroundColor Cyan
    npm install
}

if (-not $env:PORT) { $env:PORT = '3004' }
if (-not $env:DISABLE_PARAPHEUR_CRON) { $env:DISABLE_PARAPHEUR_CRON = '1' }

Write-Host "Backend parapheur sur http://localhost:$($env:PORT) (cron relances : $(if ($env:DISABLE_PARAPHEUR_CRON -eq '1') { 'désactivé' } else { 'actif' }))" -ForegroundColor Green
node server.js

param(
  [int]$UiPort = 8080
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

try {
  node --version | Out-Null
} catch {
  Write-Host 'Node.js is required. Please install Node 18+.'
  exit 1
}

try {
  node -e "require('esbuild')" 2>$null
} catch {
  Push-Location $root
  try { npm i esbuild@0.21 --no-audit --no-fund -D } catch {}
  Pop-Location
}

Push-Location $root
node tools/build-local-nmy.mjs
Pop-Location

# Ensure UI server
try {
  (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$UiPort/" -TimeoutSec 2) | Out-Null
} catch {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'
  $psi.Arguments = 'tools/ui-server.mjs'
  $psi.WorkingDirectory = $root
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = 'Hidden'
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  Start-Sleep -Milliseconds 500
}

Start-Process "http://127.0.0.1:$UiPort/local-dist/NMY.local.html"


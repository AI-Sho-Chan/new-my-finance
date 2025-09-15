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

# Ensure Tailwind CLI is available and build CSS for NMY.html
try {
  npx tailwindcss -v 2>$null | Out-Null
} catch {
  Push-Location $root
  try { npm i tailwindcss@3 autoprefixer@10 postcss@8 --no-audit --no-fund -D } catch {}
  Pop-Location
}

# Prepare minimal Tailwind config and input if missing
if (-not (Test-Path (Join-Path $root 'tools/tailwind-local.config.js'))) {
  $cfg = "module.exports = { content: ['NMY.html'], theme: { extend: {} }, plugins: [] };"
  Set-Content -Path (Join-Path $root 'tools/tailwind-local.config.js') -Value $cfg -Encoding UTF8
}
if (-not (Test-Path (Join-Path $root 'tools/tailwind-local.css'))) {
  $css = "@tailwind base;`n@tailwind components;`n@tailwind utilities;`n"
  Set-Content -Path (Join-Path $root 'tools/tailwind-local.css') -Value $css -Encoding UTF8
}

# Build Tailwind CSS
Push-Location $root
try { npx tailwindcss -c tools/tailwind-local.config.js -i tools/tailwind-local.css -o local-dist/tailwind.css --minify } catch {}
Pop-Location

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

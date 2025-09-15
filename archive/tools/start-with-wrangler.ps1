$ErrorActionPreference = 'Stop'

Write-Host 'Starting Cloudflare Worker (wrangler dev) and static server...'

# Check wrangler
$wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wrangler) {
  Write-Error 'wrangler not found. Install with: npm i -g wrangler'
  exit 1
}

# Start wrangler dev on 8787
$wranglerProc = Start-Process -FilePath 'wrangler' -ArgumentList @('dev') -WorkingDirectory 'cf-worker' -PassThru
Start-Sleep -Seconds 3

# Start static server on 5500
$staticProc = Start-Process -FilePath 'node' -ArgumentList 'tools/static-server.mjs' -PassThru
Start-Sleep -Seconds 2

# Open UI
Start-Process 'http://localhost:5500/NMY.html'

Write-Host "Ready. If blank, run in Console:`n  window.__YF_PROXY__ = 'http://127.0.0.1:8787/api/yf'; location.reload();"
Write-Host ("To stop: Stop-Process -Id {0}; Stop-Process -Id {1}" -f $wranglerProc.Id, $staticProc.Id)

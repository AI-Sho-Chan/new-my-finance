param(
  [int]$UiPort = 8080
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

function Start-Node($script, $args) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'
  $psi.Arguments = "$script $args"
  $psi.WorkingDirectory = $root
  $psi.WindowStyle = 'Hidden'
  $psi.CreateNoWindow = $true
  [System.Diagnostics.Process]::Start($psi) | Out-Null
}

try {
  # Start local YF proxy
  $ping = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/yf/ping' -UseBasicParsing -TimeoutSec 2
  if ($ping.StatusCode -ne 200) { throw 'proxy not started' }
} catch {
  Start-Node 'tools/local-yf-proxy.mjs' ''
  Start-Sleep -Milliseconds 500
}

# Try J-Quants token refresh (optional)
try {
  node tools/jq-login.mjs | Out-Null
} catch {}

# Start UI server
try {
  $uip = Invoke-WebRequest -Uri "http://127.0.0.1:$UiPort/" -UseBasicParsing -TimeoutSec 2
} catch {
  Start-Node 'tools/ui-server.mjs' ""
  Start-Sleep -Milliseconds 500
}

# Open the UI
$url = "http://127.0.0.1:$UiPort/NMY.html"
Start-Process $url | Out-Null

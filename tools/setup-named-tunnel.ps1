param(
  [string]$TunnelName = 'nmy-local',
  [string]$Hostname,   # e.g. nmy.your-domain.com (zone must be on your Cloudflare account)
  [int]$UiPort = 8080
)

$ErrorActionPreference = 'SilentlyContinue'

if (-not $Hostname) {
  Write-Host 'ERROR: -Hostname is required (e.g. -Hostname nmy.example.com)'
  exit 1
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$me = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $me 'cloudflared.exe'

function Ensure-Cloudflared() {
  if (-not (Test-Path $bin)) {
    Write-Host 'Downloading cloudflared (Windows amd64)...'
    $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Invoke-WebRequest -Uri $url -OutFile $bin -UseBasicParsing
  }
}

function Start-UiServer($port) {
  try {
    (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$port/") | Out-Null
  } catch {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'
    $psi.Arguments = 'tools/ui-server.mjs'
    $psi.WorkingDirectory = $root
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = 'Hidden'
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    Start-Sleep -Seconds 1
  }
}

function Exec($file, $args) {
  & $file @args
  return $LASTEXITCODE
}

Ensure-Cloudflared
Start-UiServer -port $UiPort

$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
$cert = Join-Path $cfDir 'cert.pem'

if (-not (Test-Path $cert)) {
  Write-Host 'cloudflared not logged in. Opening browser to authenticate...'
  Start-Process -FilePath $bin -ArgumentList @('tunnel','login') | Out-Null
  Write-Host 'After browser login, press Enter to continue.'
  [void][System.Console]::ReadLine()
}

# Check if tunnel exists
Write-Host "Ensuring tunnel '$TunnelName' exists..."
$null = & $bin tunnel list 2>$null | Out-String
$exists = $false
$tunnelId = ''
try {
  $list = & $bin tunnel list 2>$null | Out-String
  foreach ($line in $list -split "`n") {
    if ($line -match "^\s*([0-9a-f\-]{36})\s+$TunnelName\b") { $exists=$true; $tunnelId=$Matches[1]; break }
  }
} catch {}

if (-not $exists) {
  Write-Host 'Creating tunnel...'
  $out = & $bin tunnel create $TunnelName 2>&1 | Out-String
  # Parse the created ID from output or from list
  $list2 = & $bin tunnel list 2>$null | Out-String
  foreach ($line in $list2 -split "`n") {
    if ($line -match "^\s*([0-9a-f\-]{36})\s+$TunnelName\b") { $tunnelId=$Matches[1]; break }
  }
}

if (-not $tunnelId) {
  Write-Host 'ERROR: Could not determine tunnel ID.'
  exit 2
}

$credFile = Join-Path $cfDir ($tunnelId + '.json')
$configPath = Join-Path $cfDir 'config.yml'

$yml = @(
  "tunnel: $tunnelId",
  "credentials-file: $credFile",
  "ingress:",
  "  - hostname: $Hostname",
  "    service: http://127.0.0.1:$UiPort",
  "  - service: http_status:404"
) -join "`r`n"
Set-Content -Path $configPath -Value $yml -Encoding UTF8
Write-Host "Wrote config: $configPath"

Write-Host 'Creating DNS route (CNAME) ...'
& $bin tunnel route dns $TunnelName $Hostname | Out-Null

Write-Host 'Starting named tunnel in background...'
Start-Process -FilePath $bin -ArgumentList @('tunnel','run',$TunnelName) -WindowStyle Hidden

Write-Host "Done. Access URL: https://$Hostname"
Write-Host 'To auto-start at logon, run: tools\install-named-tunnel-autostart.ps1 -TunnelName "'"$TunnelName"'"'


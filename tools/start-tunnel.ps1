param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$me = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $me 'cloudflared.exe'
$outLog = Join-Path $me 'cloudflared.out.log'
$errLog = Join-Path $me 'cloudflared.err.log'

if (-not (Test-Path $bin)) {
  Write-Host 'Downloading cloudflared (Windows amd64)...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Invoke-WebRequest -Uri $url -OutFile $bin -UseBasicParsing
}

# Ensure UI server is up
try {
  (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2) | Out-Null
} catch {
  Write-Host 'UI server not detected. Starting it...'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'
  $psi.Arguments = 'tools/ui-server.mjs'
  $psi.WorkingDirectory = $root
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = 'Hidden'
  [System.Diagnostics.Process]::Start($psi) | Out-Null
  Start-Sleep -Seconds 1
}

Write-Host "Starting tunnel to http://127.0.0.1:$Port ..."
if (Test-Path $outLog) { Remove-Item $outLog -Force }
if (Test-Path $errLog) { Remove-Item $errLog -Force }
$p = Start-Process -FilePath $bin -ArgumentList @('tunnel','--no-autoupdate','--loglevel','info','--url',"http://127.0.0.1:$Port") -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

$publicUrl = $null
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline -and -not $publicUrl) {
  Start-Sleep -Milliseconds 500
  $txt = (Get-Content $outLog -ErrorAction SilentlyContinue -Raw) + "`n" + (Get-Content $errLog -ErrorAction SilentlyContinue -Raw)
  if ($txt) {
    $m = [regex]::Match($txt, 'https?://[A-Za-z0-9\-\.]+\.trycloudflare\.com\S*')
    if ($m.Success) { $publicUrl = $m.Value }
  }
}

if ($publicUrl) {
  Write-Host "Public URL: $publicUrl"
  try { Set-Clipboard -Value $publicUrl } catch {}
  try { Start-Process $publicUrl | Out-Null } catch {}
} else {
  Write-Host 'Still waiting for tunnel URL. Check logs:'
  Write-Host "  $outLog"
  Write-Host "  $errLog"
}

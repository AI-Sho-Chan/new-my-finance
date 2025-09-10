param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'SilentlyContinue'
$me = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $me 'cloudflared.exe'
if (-not (Test-Path $bin)) {
  Write-Host 'Downloading cloudflared (Windows amd64)...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  Invoke-WebRequest -Uri $url -OutFile $bin -UseBasicParsing
}
Write-Host "Starting tunnel to http://127.0.0.1:$Port ..."
$p = Start-Process -FilePath $bin -ArgumentList @('tunnel','--no-autoupdate','--url',"http://127.0.0.1:$Port") -RedirectStandardOutput "$me\cloudflared.out.log" -RedirectStandardError "$me\cloudflared.err.log" -PassThru
Start-Sleep -Seconds 2
$url = Select-String -Path "$me\cloudflared.out.log" -Pattern 'https?://[\w\-]+\.trycloudflare\.com' | Select-Object -Last 1 | ForEach-Object { ($_ -split ' ')[-1] }
if ($url) {
  Write-Host "Public URL: $url"
  try { Set-Clipboard -Value $url } catch {}
} else {
  Write-Host 'Waiting for tunnel URL (check logs in tools/cloudflared.out.log)'
}


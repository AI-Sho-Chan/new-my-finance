$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'NMY-NamedTunnel-Autostart'
cmd /c schtasks /Query /TN $taskName 1>NUL 2>&1
if ($LASTEXITCODE -eq 0) { cmd /c schtasks /Delete /TN $taskName /F 1>NUL 2>&1 }
try {
  $startup = [Environment]::GetFolderPath('Startup')
  $cmdPath = Join-Path $startup 'NMY_NamedTunnel_Autostart.cmd'
  if (Test-Path $cmdPath) { Remove-Item -Force $cmdPath }
} catch {}
Write-Host 'Named tunnel autostart removed.'

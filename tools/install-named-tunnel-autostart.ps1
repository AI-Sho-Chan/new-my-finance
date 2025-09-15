param(
  [string]$TunnelName = 'nmy-local'
)

$ErrorActionPreference = 'SilentlyContinue'
$me = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $me 'cloudflared.exe'
$taskName = 'NMY-NamedTunnel-Autostart'
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$args = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"Start-Process -WindowStyle Hidden -FilePath `'$bin`' -ArgumentList 'tunnel','run','`'$TunnelName`''`""

cmd /c schtasks /Query /TN $taskName 1>NUL 2>&1
if ($LASTEXITCODE -eq 0) { cmd /c schtasks /Delete /TN $taskName /F 1>NUL 2>&1 }

# Detect admin
$runLevel = 'LIMITED'
try { $id=[Security.Principal.WindowsIdentity]::GetCurrent(); $wp=New-Object Security.Principal.WindowsPrincipal($id); if($wp.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ $runLevel='HIGHEST' } } catch {}

cmd /c schtasks /Create /TN $taskName /TR "`"$psExe`" $args" /SC ONLOGON /RL $runLevel /IT /F 1>NUL 2>&1
if ($LASTEXITCODE -ne 0) {
  try {
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not (Test-Path $startup)) { throw 'Startup folder not found' }
    $cmdPath = Join-Path $startup 'NMY_NamedTunnel_Autostart.cmd'
    $content = "@echo off`r`nstart "" `"$bin`" tunnel run `"$TunnelName`"`r`n"
    Set-Content -Encoding ASCII -Path $cmdPath -Value $content
    Write-Host "Created Startup shortcut: $cmdPath"
  } catch {
    Write-Host 'Failed to create scheduled task. Try running PowerShell as Administrator.'
  }
} else {
  Write-Host "Named tunnel autostart installed: $taskName (RunLevel=$runLevel)"
}


param(
  [int]$UiPort = 8080
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$taskName = 'NewMyFinance-Autostart'
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$script = Join-Path $root 'tools\start-all.ps1'
$args = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$script`" -UiPort $UiPort"

# Remove existing (ignore errors)
cmd /c schtasks /Query /TN $taskName 1>NUL 2>&1
if ($LASTEXITCODE -eq 0) { cmd /c schtasks /Delete /TN $taskName /F 1>NUL 2>&1 }

# Detect admin
$runLevel = 'LIMITED'
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $wp = New-Object Security.Principal.WindowsPrincipal($id)
  if ($wp.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { $runLevel = 'HIGHEST' }
} catch {}

# Create a per-user interactive task that runs on logon
cmd /c schtasks /Create /TN $taskName /TR "`"$psExe`" $args" /SC ONLOGON /RL $runLevel /IT /F 1>NUL 2>&1
if ($LASTEXITCODE -ne 0) {
  # Fallback: Startup folder shortcut (per-user, no admin required)
  try {
    $startup = [Environment]::GetFolderPath('Startup')
    if (-not (Test-Path $startup)) { throw 'Startup folder not found' }
    $cmdPath = Join-Path $startup 'NewMyFinance_Autostart.cmd'
    $content = "@echo off`r`nstart "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -UiPort $UiPort`r`n"
    Set-Content -Encoding ASCII -Path $cmdPath -Value $content
    Write-Host "Created Startup shortcut: $cmdPath"
    Write-Host 'This will launch the app on next logon.'
  } catch {
    Write-Host 'Failed to create scheduled task. Try running PowerShell as Administrator.'
    Write-Host 'Also failed to create Startup shortcut automatically.'
  }
} else {
  Write-Host "Autostart task installed: $taskName (RunLevel=$runLevel)"
}

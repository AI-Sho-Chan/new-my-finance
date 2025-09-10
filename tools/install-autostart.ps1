param(
  [int]$UiPort = 8080
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$taskName = 'NewMyFinance-Autostart'
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$script = Join-Path $root 'tools\start-all.ps1'
$args = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -UiPort $UiPort"

try {
  schtasks /Query /TN $taskName | Out-Null
  schtasks /Delete /TN $taskName /F | Out-Null
} catch {}

schtasks /Create /TN $taskName /TR "`"$ps`" $args" /SC ONLOGON /RL HIGHEST /F | Out-Null
Write-Host "Autostart task installed: $taskName"


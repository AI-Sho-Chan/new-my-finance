param(
  [switch]$Remove
)

$TaskName = 'NewMyFinanceDashboard'
$TaskDescription = 'Auto-start New My Finance dashboard server at logon.'
$RootDir = 'C:\AI\NewMyFinance'
$ScriptPath = Join-Path $RootDir 'watch-dashboard.ps1'
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupBat = Join-Path $StartupDir 'NewMyFinanceDashboard.bat'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  if (Test-Path $StartupBat) { Remove-Item $StartupBat -Force }
  Write-Output "Removed scheduled task '$TaskName' and startup shortcut."
  return
}

if (-not (Test-Path $ScriptPath)) {
  throw "Required script not found: $ScriptPath"
}

$PowerShellExe = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -IntervalSec 30"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

try {
  Register-ScheduledTask -TaskName $TaskName -Description $TaskDescription -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Output "Scheduled task '$TaskName' registered to run at logon."
} catch {
  Write-Warning ("Register-ScheduledTask failed: {0}" -f $_.Exception.Message)
  # Fallback: Startup folder .bat (no admin required)
  $cmd = 'start "NMY Dashboard Watchdog" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -IntervalSec 30' -f $ScriptPath
  Set-Content -Path $StartupBat -Value $cmd -Encoding ASCII -Force
  Write-Output "Fallback created: $StartupBat"
}

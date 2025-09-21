param(
  [switch]$Remove
)

$TaskName = 'NewMyFinanceDashboard'
$TaskDescription = 'Auto-start New My Finance dashboard server at logon.'
$RootDir = 'C:\AI\NewMyFinance'
$ScriptPath = Join-Path $RootDir 'start-dashboard.ps1'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Write-Output "Removed scheduled task '$TaskName'."
  return
}

if (-not (Test-Path $ScriptPath)) {
  throw "Required script not found: $ScriptPath"
}

$PowerShellExe = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Description $TaskDescription -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "Scheduled task '$TaskName' registered to run at logon."

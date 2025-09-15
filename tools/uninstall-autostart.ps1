$ErrorActionPreference = 'SilentlyContinue'
$task1 = 'NewMyFinance-Autostart'
$task2 = 'NewMyFinance-Autostart-AtStartup'

cmd /c schtasks /Query /TN $task1 1>NUL 2>&1; if($LASTEXITCODE -eq 0){ cmd /c schtasks /Delete /TN $task1 /F 1>NUL 2>&1 }
cmd /c schtasks /Query /TN $task2 1>NUL 2>&1; if($LASTEXITCODE -eq 0){ cmd /c schtasks /Delete /TN $task2 /F 1>NUL 2>&1 }

try{
  $startup = [Environment]::GetFolderPath('Startup')
  $cmdPath = Join-Path $startup 'NewMyFinance_Autostart.cmd'
  if(Test-Path $cmdPath){ Remove-Item -Force $cmdPath }
}catch{}

Write-Host 'Autostart entries removed.'


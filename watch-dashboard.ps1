param(
  [int]$IntervalSec = 30
)

$ErrorActionPreference = 'SilentlyContinue'

$Root = 'C:\AI\NewMyFinance'
$StartScript = Join-Path $Root 'start-dashboard.ps1'
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir 'watchdog.log'

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line
}

function Test-ServerUp {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/q1/status' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200) { return $true }
  } catch {}
  try {
    $l = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($l) { return $true }
  } catch {}
  return $false
}

function Start-ServerDirect {
  try {
    $nodeCmd = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodeCmd -or -not (Test-Path $nodeCmd)) {
      $nodeCmd = 'C:\\Program Files\\nodejs\\node.exe'
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeCmd
    $psi.Arguments = 'server/index.mjs'
    $psi.WorkingDirectory = (Join-Path $Root 'web')
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = 'Hidden'
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    return $true
  } catch {
    Write-Log ("Direct start failed: {0}" -f $_.Exception.Message)
    return $false
  }
}

Write-Log "Watchdog started. Interval=${IntervalSec}s"
while ($true) {
  if (-not (Test-ServerUp)) {
    Write-Log 'Server down or unresponsive. Attempting restart...'
    $ok = $false
    try {
      & $StartScript -ForceRestart | Out-Null
      Write-Log 'Restart command issued via start-dashboard.ps1.'
    } catch {
      Write-Log ("Restart via script failed: {0}" -f $_.Exception.Message)
    }
    Start-Sleep -Seconds 1
    if (Test-ServerUp) { $ok = $true }
    if (-not $ok) {
      if (Start-ServerDirect) { Write-Log 'Restarted by direct node spawn.' }
    }
  }
  Start-Sleep -Seconds $IntervalSec
}

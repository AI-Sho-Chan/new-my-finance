param(
  [switch]$ForceRestart
)

$script:Root = 'C:\AI\NewMyFinance'
$script:WebDir = Join-Path $script:Root 'web'
$NodeExeCandidates = @(
  (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
  'node'
) | Where-Object { $_ }

function Get-NodeExe {
  foreach ($path in $NodeExeCandidates) {
    try {
      if (Test-Path $path) { return $path }
      $which = (Get-Command $path -ErrorAction SilentlyContinue)
      if ($which) { return $which.Path }
    } catch {}
  }
  throw 'node.exe が見つかりませんでした。Node.js をインストールしてください。'
}

function Stop-ExistingServer {
  try {
    $listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      $pids = $listener | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($pid in $pids) {
        try {
          $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
          if ($proc -and $proc.Path -like '*node*') {
            $proc.CloseMainWindow() | Out-Null
            Start-Sleep -Seconds 1
            if (!$proc.HasExited) { $proc.Kill() }
          }
        } catch {}
      }
    }
  } catch {}
}

function Ensure-Server {
  $node = Get-NodeExe
  if (-not (Test-Path $script:WebDir)) { throw "Web ディレクトリが見つかりません: $script:WebDir" }
  $listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
  if ($listener -and -not $ForceRestart) { return }
  if ($ForceRestart) { Stop-ExistingServer }

  $logDir = Join-Path $script:Root 'logs'
  New-Item -Path $logDir -ItemType Directory -Force | Out-Null
  $logFile = Join-Path $logDir 'dashboard-server.log'

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.WorkingDirectory = $script:WebDir
  $startInfo.Arguments = 'server/index.mjs'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $proc = [System.Diagnostics.Process]::Start($startInfo)
  if ($proc) {
    $proc.EnableRaisingEvents = $true
    $handler = [System.Diagnostics.DataReceivedEventHandler] {
      param([object] $sender, [System.Diagnostics.DataReceivedEventArgs] $args)
      if ($null -ne $args.Data) {
        $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $args.Data
        Add-Content -Path $logFile -Value $line
      }
    }
    $proc.add_OutputDataReceived($handler)
    $proc.add_ErrorDataReceived($handler)
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
  }
}

Ensure-Server

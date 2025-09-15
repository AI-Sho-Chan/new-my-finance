param(
  [int]$UiPort = 8080,
  [int]$ProxyPort = 8787,
  [int]$IntervalSec = 15
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

function Test-HttpOk($url, $timeoutSec = 2){
  try{
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $timeoutSec -Uri $url
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  }catch{ return $false }
}

function Start-Node($scriptRel, $args){
  try{
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'
    $psi.Arguments = "$scriptRel $args"
    $psi.WorkingDirectory = $root
    $psi.WindowStyle = 'Hidden'
    $psi.CreateNoWindow = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null
  }catch{}
}

while($true){
  # Ensure local YF proxy on 8787
  if(-not (Test-HttpOk "http://127.0.0.1:$ProxyPort/api/yf/ping")){
    Start-Node 'tools/local-yf-proxy.mjs' ''
    Start-Sleep -Milliseconds 800
  }

  # Ensure UI server on UiPort
  if(-not (Test-HttpOk "http://127.0.0.1:$UiPort/")){
    Start-Node 'tools/ui-server.mjs' ''
    Start-Sleep -Milliseconds 800
  }

  Start-Sleep -Seconds $IntervalSec
}


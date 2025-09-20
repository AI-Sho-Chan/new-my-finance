param(
    [switch]$Login
)

$exeName = 'cloudflared-windows-amd64.exe'
$exePath = Join-Path -Path $PSScriptRoot -ChildPath $exeName
if (-not (Test-Path $exePath)) {
    Write-Host "${exeName} が見つかりません。`n$exePath に配置してください。" -ForegroundColor Red
    exit 1
}

if ($Login) {
    Write-Host 'Cloudflare にブラウザ経由でログインします...' -ForegroundColor Cyan
    & $exePath 'tunnel' 'login'
    exit $LASTEXITCODE
}

$cloudflaredDir = Join-Path $env:USERPROFILE '.cloudflared'
$certPath = Join-Path $cloudflaredDir 'cert.pem'
if (-not (Test-Path $certPath)) {
    Write-Host '初回は `cloudflared_quick_tunnel.ps1 -Login` を先に実行してください。' -ForegroundColor Yellow
    exit 1
}

Write-Host 'ローカル http://127.0.0.1:8080 を Cloudflare Quick Tunnel へ公開します...' -ForegroundColor Cyan
Write-Host 'PowerShell を閉じるとトンネルも終了します。' -ForegroundColor DarkGray
& $exePath 'tunnel' '--url' 'http://127.0.0.1:8080'

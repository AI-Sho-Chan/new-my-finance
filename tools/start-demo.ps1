# Launch local YF proxy and static server, then open the UI
Continue = 'Stop'

# Start proxy on 8787
 = Start-Process -FilePath node -ArgumentList "tools/local-yf-proxy.mjs" -PassThru
Start-Sleep -Seconds 1

# Start static server on 5500 (serves project root)
 = Start-Process -FilePath node -ArgumentList "tools/static-server.mjs" -PassThru
Start-Sleep -Seconds 2

# Open browser
Start-Process "http://localhost:5500/NMY.html"

Write-Host "Started. To stop: Stop-Process -Id ; Stop-Process -Id "

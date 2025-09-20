@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0cloudflared_quick_tunnel.ps1" %*
pause

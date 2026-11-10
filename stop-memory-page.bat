@echo off
rem Stop the memory page process started from this folder.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$here = Split-Path -Parent '%~f0'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(($here + '\server.js')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Memory page stopped.
timeout /t 2 >nul
exit /b 0
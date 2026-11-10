@echo off
rem Start the dsh-thirdparty-memory page (http://127.5.0.1:7891/) without a console window.
start "" wscript.exe "%~dp0start-memory-page.vbs"
timeout /t 2 >nul
start "" "http://127.5.0.1:7891/"
exit /b 0
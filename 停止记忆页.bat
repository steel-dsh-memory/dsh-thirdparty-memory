@echo off
chcp 65001 >nul
rem 停止「记忆」页面（只结束本目录 server.js 的进程）。
call "%~dp0stop-memory-page.bat"
exit /b 0
@echo off
chcp 65001 >nul
rem 启动「记忆」页面：http://127.5.0.1:7891/
rem 走可携带的 start-memory-page.vbs（纯 ASCII、运行时推导路径），静默不弹框。
start "" wscript.exe "%~dp0start-memory-page.vbs"
timeout /t 2 >nul
start "" "http://127.5.0.1:7891/"
exit /b 0
@echo off
chcp 65001 >nul
title 留痕 · 同步服务 (http://localhost:8787)
cd /d "%~dp0"
echo [留痕] 正在启动同步服务...
echo [留痕] 网页端地址: http://localhost:8787
echo [留痕] 网页端与桌面端共用同一数据库，实时同步
echo [留痕] 关闭本窗口即停止服务
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8787/"
node scripts/serve.mjs
pause

@echo off
rem 双击启动“留痕”原型：本地服务 + 默认浏览器打开
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"

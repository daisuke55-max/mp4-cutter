@echo off
rem Double-click to start. Close this window to quit.
cd /d "%~dp0"
chcp 65001 >nul
node server.js
if errorlevel 1 pause

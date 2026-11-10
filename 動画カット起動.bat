@echo off
rem Double-click to start. Close this window to quit.
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run the setup file first ^(see README^), then restart the PC if needed.
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause

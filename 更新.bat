@echo off
rem Double-click to update to the latest version.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" & pause & exit /b

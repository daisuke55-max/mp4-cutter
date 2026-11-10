@echo off
rem Double-click once to install Node.js and ffmpeg.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause

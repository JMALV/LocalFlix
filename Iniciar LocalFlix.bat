@echo off
title LocalFlix
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js: ejecuta Instalar.bat & pause & exit /b 1)
start "" /b cmd /c "timeout /t 3 >nul & start http://localhost:8484"
node server.js
pause

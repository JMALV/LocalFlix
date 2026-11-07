@echo off
chcp 65001 >nul
title Instalar LocalFlix
cd /d "%~dp0"
echo.
echo  Instalador de LocalFlix
echo  -----------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Instalando Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
) else (
  echo  Node.js ya esta instalado.
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe" (
    echo  ffmpeg ya esta instalado.
  ) else (
    echo  Instalando ffmpeg...
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  )
) else (
  echo  ffmpeg ya esta instalado.
)

echo.
choice /c SN /m " Iniciar LocalFlix automaticamente con Windows"
if errorlevel 2 goto fin
call "%~dp0Activar arranque automatico.bat" nopause

:fin
echo.
echo  Listo. Cierra esta ventana y abre "Iniciar LocalFlix.bat".
echo  (Si Node.js se acaba de instalar, hace falta abrirlo desde una ventana nueva.)
echo.
pause

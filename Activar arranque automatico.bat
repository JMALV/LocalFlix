@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\LocalFlix.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"' + (Resolve-Path 'LocalFlix (segundo plano).vbs') + '\"'; $s.WorkingDirectory = (Get-Location).Path; $s.Save()"
echo  Arranque automatico activado: LocalFlix se inicia sin ventana al entrar a Windows.
if not "%1"=="nopause" pause

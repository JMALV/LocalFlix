@echo off
powershell -NoProfile -Command "$n = 0; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'powershell' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $n++ }; if ($n) { 'LocalFlix detenido.' } else { 'LocalFlix no estaba corriendo.' }"
timeout /t 3 >nul

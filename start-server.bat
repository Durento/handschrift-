@echo off
rem Startet einen lokalen Webserver fuer die Handschrift-App (Python noetig).
cd /d "%~dp0"
echo.
echo  Handschrift-App laeuft. Auf dem iPad (im selben WLAN) in Safari oeffnen:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:8000
echo.
echo  Beenden mit Strg+C oder Fenster schliessen.
echo.
python -m http.server 8000

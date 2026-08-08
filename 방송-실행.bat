@echo off
rem JonggemsSim launcher - clip video/replay needs http (file:// blocks canvas capture)
cd /d "%~dp0"
start "" "http://localhost:8770"
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8770
) else (
  py -m http.server 8770
)

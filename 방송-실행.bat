@echo off
rem JonggemsSim launcher - clip video/replay needs http (file:// blocks canvas capture)
cd /d "%~dp0"

rem `python` on PATH may be Python 2 (no http.server) or the Store stub, so try the py launcher first
set "PY="
py -3 -c "import http.server" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import http.server" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo [!] Python 3 not found. Install it from https://www.python.org/downloads/
  echo     ^(or just open the deployed link: https://bjh7536.github.io/JonggemsSim/^)
  pause
  exit /b 1
)

start "JonggemsSim server - close this window to stop" %PY% -m http.server 8770

rem wait until the port actually answers - opening the browser first shows "cannot connect"
for /l %%i in (1,1,30) do (
  curl -s -o nul http://localhost:8770/ && goto :open
  timeout /t 1 /nobreak >nul
)
echo [!] Server did not come up on port 8770 ^(already in use?^).
pause
exit /b 1

:open
start "" "http://localhost:8770/"
exit /b 0

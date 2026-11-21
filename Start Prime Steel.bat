@echo off
setlocal
title Prime Steel Order Book
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo   Python 3 was not found on this computer.
  echo   Install it from https://www.python.org/downloads/ and tick
  echo   "Add python.exe to PATH", then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"
if not exist "exports" mkdir "exports"

start "" http://localhost:8077/admin
%PY% server.py --port 8077
echo.
echo   Server stopped.
pause

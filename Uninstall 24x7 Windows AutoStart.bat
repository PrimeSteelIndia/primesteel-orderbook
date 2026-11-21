@echo off
setlocal
title Remove Prime Steel 24x7 Auto-Start
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Prime Steel 24x7.lnk"

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo [OK] Prime Steel 24x7 auto-start shortcut removed.
) else (
    echo Auto-start shortcut was not present.
)
echo.
pause

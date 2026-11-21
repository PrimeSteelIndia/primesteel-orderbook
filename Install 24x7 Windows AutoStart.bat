@echo off
setlocal
title Install Prime Steel 24x7 Auto-Start
cd /d "%~dp0"

echo.
echo ========================================================
echo   Prime Steel - Configure 24x7 Auto-Start on Windows Boot
echo ========================================================
echo.

set "TARGET=%~dp0Start Prime Steel 24x7 (Silent Background).vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Prime Steel 24x7.lnk"

echo Creating startup shortcut in:
echo   "%SHORTCUT%"
echo.

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET%\"'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Prime Steel 24x7 Service'; $s.Save()"

if exist "%SHORTCUT%" (
    echo [OK] 24x7 Auto-Start installed successfully!
    echo Prime Steel will now automatically start in the background whenever your PC turns on.
) else (
    echo [ERROR] Failed to create startup shortcut.
)

echo.
pause

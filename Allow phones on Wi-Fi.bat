@echo off
setlocal
title Allow phones to reach Prime Steel
echo.
echo   This adds a Windows Firewall rule for port 8077 so phones and your
echo   Mac can open the order book over Wi-Fi.
echo.
net session >nul 2>&1
if errorlevel 1 (
  echo   Please right-click this file and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Prime Steel Order Book" >nul 2>&1
netsh advfirewall firewall add rule name="Prime Steel Order Book" dir=in action=allow protocol=TCP localport=8077 profile=private,domain
echo.
echo   Done. Phones on the same Wi-Fi can now connect.
echo.
pause

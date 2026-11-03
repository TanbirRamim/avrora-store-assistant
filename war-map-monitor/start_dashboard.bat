@echo off
title Avrora War Map Dashboard Server
color 0E

echo ======================================================================
echo    AVRORA STORES: REAL-TIME WAR MAP SITUATIONAL DASHBOARD
echo ======================================================================
echo.
echo [1/2] Changing to project directory...
cd /d "%~dp0"

echo [2/2] Launching Web Server on http://localhost:8000 ...
set PYTHONIOENCODING=utf-8

:: Open default web browser after a 2-second delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8000"

:: Start the Python server
python server.py

echo.
echo Server stopped.
pause

@echo off
title Avrora War Map Live Terminal Monitor
color 0B

cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

python monitor.py --interval 30

pause

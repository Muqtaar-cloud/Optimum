@echo off
rem Keeps the bot running: restarts it 10s after any crash.
rem Stops on config errors (exit 2), another instance already running (exit 3),
rem or the kill switch file data\STOP (exit 4).
cd /d "%~dp0"
:loop
call npm start
if %ERRORLEVEL%==2 goto stopped
if %ERRORLEVEL%==3 goto stopped
if %ERRORLEVEL%==4 goto stopped
echo Bot exited with code %ERRORLEVEL%, restarting in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
:stopped
echo Bot stopped with code %ERRORLEVEL%. Fix the message above, then run this again.
pause

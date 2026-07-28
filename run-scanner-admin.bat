@echo off
REM JobHunter AI - Toggle Scanner
REM Usage: run-scanner-admin.bat [start|stop|status]
setlocal enabledelayedexpansion

set TASK_NAME=JobHunter AI Scanner
set BAT_PATH=C:\VA\Website\jobhunter-ai\run-scanner.bat

if /I "%1"=="start" goto start
if /I "%1"=="stop" goto stop
if /I "%1"=="status" goto status
echo Usage: %0 [start^|stop^|status]
goto :eof

:start
echo Creating scheduled task "%TASK_NAME%"...
schtasks /create /tn "%TASK_NAME%" /tr "%BAT_PATH%" /sc minute /mo 30 /ru "%USERNAME%" /f
if %errorlevel% equ 0 (
  echo ✅ Scanner scheduled! Runs every 30 minutes while your PC is on.
  echo    Telegram notifications will come to your phone.
) else (
  echo ❌ Failed to create task. Try running as Administrator.
)
goto :eof

:stop
echo Stopping scheduled task "%TASK_NAME%"...
schtasks /end /tn "%TASK_NAME%" 2>nul
schtasks /delete /tn "%TASK_NAME%" /f
if %errorlevel% equ 0 (
  echo ✅ Scanner stopped. No more scheduled runs.
) else (
  echo ❌ Failed to stop task.
)
goto :eof

:status
schtasks /query /tn "%TASK_NAME%" /fo LIST /v 2>nul | findstr /i "TaskName|Status|Next Run|Schedule"
if %errorlevel% neq 0 echo ❌ No scheduled task found. Run "start" to create it.
goto :eof

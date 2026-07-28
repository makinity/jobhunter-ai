@echo off
REM JobHunter AI Scanner - Windows Scheduled Task Runner
REM Retries up to 3 times in case of transient errors (sleep/resume, etc.)

set MAX_RETRIES=3
set RETRY_DELAY=10
set COUNT=0
set PROJECT_DIR=C:\VA\Website\jobhunter-ai
set LOG_FILE=%PROJECT_DIR%\scanner-log.txt

:retry
cd /d "%PROJECT_DIR%"
echo [%DATE% %TIME%] Starting scan attempt %COUNT%/%MAX_RETRIES%... >> "%LOG_FILE%"
"C:\Program Files\nodejs\node.exe" src\index.js --once >> "%LOG_FILE%" 2>&1
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% NEQ 0 (
  set /a COUNT=%COUNT%+1
  if %COUNT% LSS %MAX_RETRIES% (
    echo [%DATE% %TIME%] Scan failed (code %EXIT_CODE%). Retrying in %RETRY_DELAY%s... >> "%LOG_FILE%"
    timeout /t %RETRY_DELAY% /nobreak >nul
    goto retry
  ) else (
    echo [%DATE% %TIME%] Scan failed after %MAX_RETRIES% attempts (code %EXIT_CODE%). >> "%LOG_FILE%"
  )
) else (
  echo [%DATE% %TIME%] Scan completed successfully. >> "%LOG_FILE%"
)

exit /b %EXIT_CODE%

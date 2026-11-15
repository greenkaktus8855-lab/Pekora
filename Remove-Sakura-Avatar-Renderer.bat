@echo off
setlocal
cd /d "%~dp0"

echo.
echo Sakura Avatar and Renderer Removal
echo ===================================
echo.

git pull --ff-only origin main
if errorlevel 1 (
    echo.
    echo Could not update Sakura files from GitHub.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remove-avatar-renderer.ps1"
if errorlevel 1 (
    echo.
    echo Cleanup did not finish. Read the message above.
    pause
    exit /b 1
)

echo.
echo Sakura Avatar and Renderer removal completed.
pause

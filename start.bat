@echo off

REM Check if Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Bun not installed
    echo Install: powershell -c "irm bun.sh/install.ps1 | iex"
    pause
    exit /b 1
)

REM Install dependencies if needed
if not exist "node_modules\" (
    echo Installing dependencies...
    call bun install
    if !errorlevel! neq 0 exit /b 1
)

REM Start server
set NODE_TLS_REJECT_UNAUTHORIZED=0
bun --hot src/index.ts
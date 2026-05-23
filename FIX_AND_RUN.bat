@echo off
echo ========================================
echo EdiAgil - Fix & Run Script
echo ========================================
echo.
echo [1/4] Cleaning previous builds...
rmdir /s /q node_modules 2>nul
del /s /q dist 2>nul
echo Done!
echo.
echo [2/4] Installing dependencies...
call npm install
echo Done!
echo.
echo [3/4] Type checking...
call npm run lint 2>&1 | findstr /R "error"
if errorlevel 1 (
  echo Type checking completed
) else (
  echo Note: Some type issues found, but continuing...
)
echo.
echo [4/4] Starting development server on http://localhost:3000...
call npm run dev
pause

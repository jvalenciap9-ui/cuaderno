@echo off
cd /d "c:\Users\José Valencia\Desktop\ediagil"
echo Limpiando caché de npm y vite...
call npm cache clean --force 2>nul
call npm run clean 2>nul
echo.
echo Instalando dependencias...
call npm install
echo.
echo Ejecutando TypeScript check...
call npm run lint
echo.
echo Iniciando servidor de desarrollo...
call npm run dev
pause

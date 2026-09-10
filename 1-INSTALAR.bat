@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   CONCILIO WANTED BOT - INSTALACION
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js no esta instalado.
  echo Instala Node.js 20 o superior y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
node -v
npm -v
echo.
echo Instalando dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR durante npm install.
  pause
  exit /b 1
)
echo.
echo LISTO. Ahora abre el archivo .env y pega tu BOT_TOKEN.
echo Despues ejecuta 2-REGISTRAR-COMANDO.bat
pause

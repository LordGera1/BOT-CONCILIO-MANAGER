@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Registrando /sentenciar en el Discord de tickets...
call npm run deploy
pause

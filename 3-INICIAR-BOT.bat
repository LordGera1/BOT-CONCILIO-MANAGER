@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Iniciando Concilio WANTED Bot...
call npm start
pause

@echo off
chcp 65001 >nul
echo Открываю http://localhost:8080 (остановить: Ctrl+C)
start "" http://localhost:8080
python -m http.server 8080

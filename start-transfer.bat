@echo off
cd /d %~dp0
start "Wild File Transfer backend" cmd /k "cd /d %~dp0backend && go run main.go"
timeout /t 1 >nul
start "" "http://localhost:8080/index.html"

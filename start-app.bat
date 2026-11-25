@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org then run this file again. & pause & exit /b)
echo Starting the app... keep this window open.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"
npm start
pause

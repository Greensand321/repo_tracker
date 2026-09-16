@echo off
REM Bearing - double-click this, or pin a shortcut to it.
REM It starts the local program and opens the dashboard in your browser.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(version 22 or newer^).
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - installing dependencies. This happens once.
  call npm install || (echo npm install failed. & pause & exit /b 1)
)

npm start
pause

@echo off
rem Double-click this to run mitreden on Windows.
rem
rem Your sentences, config and audio files land in the folder this file sits
rem in. While this window is open, mitreden runs; closing it stops the program
rem and leaves everything else where it is.

cd /d "%~dp0"
set IMAGE=ghcr.io/steffipetaffy/mitreden:latest
if "%MITREDEN_PORT%"=="" set MITREDEN_PORT=8770

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is missing. mitreden runs inside it.
  echo Get it here, then start this file again:
  echo   https://www.docker.com/products/docker-desktop/
  echo.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is installed but not running. Start Docker Desktop,
  echo wait until its whale icon stops moving, then start this file again.
  echo.
  pause
  exit /b 1
)

rem A second double-click should not spill a container error over the window.
for /f %%i in ('docker ps -q -f name^=^^mitreden$') do set RUNNING=%%i
if defined RUNNING (
  echo mitreden is already running at http://localhost:%MITREDEN_PORT%
  start http://localhost:%MITREDEN_PORT%/
  exit /b 0
)
docker rm -f mitreden >nul 2>&1

echo Fetching mitreden ^(the first time this takes a few minutes^) ...
docker pull -q %IMAGE%
if errorlevel 1 (
  echo Could not fetch the image. Are you online?
  pause
  exit /b 1
)

rem Give the server a moment, then open the browser.
start "" /b cmd /c "timeout /t 4 >nul & start http://localhost:%MITREDEN_PORT%/"

echo.
echo mitreden is running at http://localhost:%MITREDEN_PORT%
echo Close this window to stop it.
echo.
docker run --rm --name mitreden -p %MITREDEN_PORT%:8770 -v "%cd%:/data" %IMAGE%
if errorlevel 1 (
  echo.
  echo That did not start. Most often something else is using port %MITREDEN_PORT%.
  echo You can pick another one:  set MITREDEN_PORT=8790 ^&^& mitreden.bat
  pause
)

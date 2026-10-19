@echo off
setlocal
rem vidkit studio entry point. Finds Python, puts the project's ffmpeg first on PATH.
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONIOENCODING=utf-8"
set "PY="
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if not defined PY if exist "videoeditor_venv\Scripts\python.exe" set "PY=videoeditor_venv\Scripts\python.exe"
if not defined PY (
  where py >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  echo Python 3.11+ not found. Install it from python.org, then run doctor.bat.
  exit /b 1
)
if exist "tools\ffmpeg\bin\ffmpeg.exe" set "PATH=%~dp0tools\ffmpeg\bin;%PATH%"
if "%~1"=="" (
  echo usage: render.bat projects\showcase.json [--range 2.0-4.5] [--preset 1080p30^|1080p60^|vertical^|720p30] [--draft]
  exit /b 2
)
%PY% -m studio.render %*

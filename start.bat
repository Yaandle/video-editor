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
%PY% -c "import fastapi, uvicorn, playwright, numpy, pydantic" 2>nul
if errorlevel 1 (
  echo Dependencies are missing. Running doctor to fix them...
  %PY% -m studio.doctor --quick
  if errorlevel 1 exit /b 1
)
echo Starting vidkit studio at http://127.0.0.1:8765/  (Ctrl+C to stop)
%PY% -m studio.server --open %*

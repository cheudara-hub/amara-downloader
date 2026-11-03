@echo off
set ELECTRON_RUN_AS_NODE=
if exist "%~dp0artifacts\pending-update.asar" (
  python "%~dp0tools\apply-pending-update.py"
  if errorlevel 1 exit /b 1
)
set "AMARA_PROJECT_ROOT=%~dp0"
set "AMARA_LAUNCH_VERSION="
for /f "delims=" %%V in ('python -c "import json,os,pathlib; print(json.loads((pathlib.Path(os.environ['AMARA_PROJECT_ROOT']) / 'source/package.json').read_text(encoding='utf-8'))['version'])"') do set "AMARA_LAUNCH_VERSION=%%V"
if exist "%~dp0release\AMARA-Downloader-v%AMARA_LAUNCH_VERSION%-Windows-Portable\AMARA Downloader.exe" (
  start "" "%~dp0release\AMARA-Downloader-v%AMARA_LAUNCH_VERSION%-Windows-Portable\AMARA Downloader.exe" --open-downloads
) else (
  start "" "%~dp0Hongguo English\AMARA Downloader.exe" --open-downloads
)

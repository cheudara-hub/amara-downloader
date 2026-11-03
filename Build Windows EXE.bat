@echo off
setlocal
title Build Latest AMARA Windows EXE
pushd "%~dp0"
if errorlevel 1 exit /b 1

py -3 --version >nul 2>&1
if not errorlevel 1 (
  set "AMARA_BUILD_PYTHON=py -3"
) else (
  python --version >nul 2>&1
  if errorlevel 1 goto missing_python
  set "AMARA_BUILD_PYTHON=python"
)

if /i "%~1"=="--check" goto run_builder
echo ===============================================
echo Build the latest AMARA source into a setup EXE
echo ===============================================
echo.
echo Includes Hongguo batch recovery and automatic update checks.
echo Checking the current version and build tools...
%AMARA_BUILD_PYTHON% -u "tools\build-windows.py" --check
set "AMARA_BUILD_RESULT=%ERRORLEVEL%"
if not "%AMARA_BUILD_RESULT%"=="0" goto build_failed
echo.
echo Validating and rebuilding from source. Compression may take several minutes.

:run_builder
%AMARA_BUILD_PYTHON% -u "tools\build-windows.py" %*
set "AMARA_BUILD_RESULT=%ERRORLEVEL%"
if /i "%~1"=="--check" goto finish
if not "%AMARA_BUILD_RESULT%"=="0" goto build_failed
echo.
echo Build complete. Your setup EXE and portable app are in the release folder.
start "" explorer.exe "%~dp0release"
goto pause_and_finish

:missing_python
echo ERROR: Python 3 was not found. Install Python 3 and run this file again.
set "AMARA_BUILD_RESULT=1"
goto pause_and_finish

:build_failed
echo.
echo Build failed. Read the error above. The previous release EXE was kept.

:pause_and_finish
echo.
if /i not "%~1"=="--no-pause" if /i not "%~2"=="--no-pause" pause

:finish
popd
exit /b %AMARA_BUILD_RESULT%

@echo off
setlocal
pushd "%~dp0"
python tools\prepare-upstream.py
set "AMARA_CHECK_RESULT=%ERRORLEVEL%"
echo.
if not "%AMARA_CHECK_RESULT%"=="0" echo Check failed. Your existing application was kept.
pause
popd
exit /b %AMARA_CHECK_RESULT%

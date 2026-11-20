@echo off
rem build-installer.bat: builds the unsigned Squirrel.Windows installer for the lab machine
rem companion manager. /s, --silent or SILENT=1 runs with no prompt. Never publishes.
setlocal
cd /d "%~dp0"
set "PSModulePath="
set "BUILD_SILENT=0"
if "%SILENT%"=="1" set "BUILD_SILENT=1"
if /i "%~1"=="/s" set "BUILD_SILENT=1"
if /i "%~1"=="--silent" set "BUILD_SILENT=1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1" -SkipCompanion
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
if not exist "%~dp0companion\package.json" (
  echo problem: companion\package.json is missing, so there is no installer to build yet.
  exit /b 3
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-companion.ps1" -Mode installer
exit /b %ERRORLEVEL%

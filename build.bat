@echo off
rem build.bat: one-click lab machine build. /s, --silent or SILENT=1 runs with no prompt.
setlocal
cd /d "%~dp0"
set "PSModulePath="
set "BUILD_SILENT=0"
if "%SILENT%"=="1" set "BUILD_SILENT=1"
if /i "%~1"=="/s" set "BUILD_SILENT=1"
if /i "%~1"=="--silent" set "BUILD_SILENT=1"
set "RUN_AFTER=0"
if "%RUN_AFTER_BUILD%"=="1" set "RUN_AFTER=1"
for %%A in (%*) do if /i "%%~A"=="--run" set "RUN_AFTER=1"
for %%A in (%*) do if /i "%%~A"=="/run" set "RUN_AFTER=1"
if "%BUILD_SILENT%"=="1" goto build
net session >nul 2>&1
if not errorlevel 1 goto build
echo Chocolatey installs for the companion need an administrator shell; asking once now through the native UAC prompt.
powershell.exe -NoProfile -Command "try { $a = @(); if ('%RUN_AFTER%' -eq '1') { $a = @('--run') }; $p = if ($a.Count) { Start-Process -FilePath '%~f0' -ArgumentList $a -Verb RunAs -Wait -PassThru -ErrorAction Stop } else { Start-Process -FilePath '%~f0' -Verb RunAs -Wait -PassThru -ErrorAction Stop }; exit $p.ExitCode } catch { exit 1223 }"
set "ELEVATED_RESULT=%ERRORLEVEL%"
if not "%ELEVATED_RESULT%"=="1223" exit /b %ELEVATED_RESULT%
echo UAC prompt declined; continuing without administrator rights.
:build
call "%~dp0download-dependencies.bat" /s || exit /b
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (echo problem: build exited %RESULT%& exit /b %RESULT%)
if not "%RUN_AFTER%"=="1" goto after_run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-after-build.ps1"
exit /b %ERRORLEVEL%
:after_run
if "%BUILD_SILENT%"=="1" exit /b 0
choice /m "Open the lab machine manager now"
if %ERRORLEVEL%==1 call "%~dp0mvl.bat" tui
exit /b 0

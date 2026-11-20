@echo off
rem download-dependencies.bat: fetches every pinned build, run and test dependency listed in
rem dependencies.json into %LOCALAPPDATA%\MaterialVmLabs\deps and verifies each SHA-256 before use.
rem /s, --silent or SILENT=1 runs with no prompt (it never prompts in either mode). Exits non-zero on
rem the first real problem. Called from another script with "call", it adds the verified tool folders
rem to that script's PATH. Nothing it fetches goes into the repository, and it needs no administrator.
set "DD_FLAGS="
if "%SILENT%"=="1" set "DD_FLAGS=-Silent"
if /i "%~1"=="/s" set "DD_FLAGS=-Silent"
if /i "%~1"=="--silent" set "DD_FLAGS=-Silent"
set "DD_PATHFILE=%TEMP%\mvl-deps-path-%RANDOM%%RANDOM%.txt"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\download-dependencies.ps1" %DD_FLAGS% -PathFile "%DD_PATHFILE%"
set "DD_RESULT=%ERRORLEVEL%"
if not "%DD_RESULT%"=="0" goto dd_fail
if not exist "%DD_PATHFILE%" goto dd_ok
for /f "usebackq delims=" %%P in ("%DD_PATHFILE%") do set "PATH=%%P;%PATH%"
del "%DD_PATHFILE%" >nul 2>&1
:dd_ok
set "DD_FLAGS="
set "DD_PATHFILE="
exit /b 0
:dd_fail
del "%DD_PATHFILE%" >nul 2>&1
echo problem: the dependency fetch stopped (exit %DD_RESULT%); see the line above for the dependency and the reason.
exit /b %DD_RESULT%

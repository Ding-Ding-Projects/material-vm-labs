@echo off
rem mvl: fast lab machine command line. Runs on the stock Windows PowerShell 5.1.
rem A PSModulePath inherited from PowerShell 7 breaks 5.1 module loading; let 5.1 rebuild its own.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\mvl.ps1" %*
exit /b %ERRORLEVEL%

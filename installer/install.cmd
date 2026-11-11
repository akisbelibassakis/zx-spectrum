@echo off
rem Started by the setup EXE (IExpress) in its temporary folder; "quiet" comes from setup /Q.
if /i "%~1"=="quiet" set ZX_QUIET=1
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install.ps1" > "%TEMP%\zx-spectrum-setup.log" 2>&1

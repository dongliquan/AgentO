@echo off
rem AgentO 2.0 — the everyday app, on the normal data folder %APPDATA%\AgentO.
rem usage: scripts\run-2.0.cmd <build folder, e.g. dist-11190955>
rem A test copy that must not touch the everyday data: set AGENTO_DATA_DIR first (a separate folder, port and profile are used).
set ELECTRON_RUN_AS_NODE=
set NoDefaultCurrentDirectoryInExePath=
if "%AGENTO_DATA_DIR%"=="" (
  set ASM_PORT=
  start "" "%~dp0..\%1\win-unpacked\AgentO.exe"
) else (
  set ASM_PORT=47870
  start "" "%~dp0..\%1\win-unpacked\AgentO.exe" --user-data-dir="%AGENTO_DATA_DIR%"
)

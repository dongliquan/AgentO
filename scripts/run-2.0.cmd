@echo off
rem AgentO 2.0 DEVELOPMENT app: its own data folder, port and Electron profile (never the everyday data in %APPDATA%\AgentO).
rem usage: scripts\run-2.0.cmd <build folder, e.g. dist-11190928>
set ELECTRON_RUN_AS_NODE=
set NoDefaultCurrentDirectoryInExePath=
set AGENTO_DATA_DIR=%APPDATA%\AgentO-2.0-dev
set ASM_PORT=47870
start "" "%~dp0..\%1\win-unpacked\AgentO.exe" --user-data-dir="%AGENTO_DATA_DIR%"

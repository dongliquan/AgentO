@echo off
rem The everyday AgentO (team build, the state before 2.0 work started) on the normal data folder %APPDATA%\AgentO.
rem Built from commit 6c36127 in the worktree C:\ClaudeCode\AgentO-daily. Do not rebuild or replace it for 2.0 work.
set ELECTRON_RUN_AS_NODE=
set NoDefaultCurrentDirectoryInExePath=
set AGENTO_DATA_DIR=
set ASM_PORT=
start "" "C:\ClaudeCode\AgentO-daily\dist-daily\win-unpacked\AgentO.exe"

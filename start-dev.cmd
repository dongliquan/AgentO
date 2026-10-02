@echo off
cd /d "%~dp0"
rem Inherited from VS Code / Claude Code: ELECTRON_RUN_AS_NODE makes Electron start as Node,
rem NoDefaultCurrentDirectoryInExePath breaks the node-pty (winpty) build. Clear both.
set ELECTRON_RUN_AS_NODE=
set NoDefaultCurrentDirectoryInExePath=
echo === AgentO (dev) ===
if not exist node_modules (
  echo [1/2] npm install - native modules compile, this can take a few minutes
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Copy the error above and send it.
    pause
    exit /b 1
  )
)
echo [2/2] npm run dev
call npm run dev
pause

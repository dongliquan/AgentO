#!/bin/bash
# Build a new AgentO and switch to it WITHOUT stopping any session.
#
# Sessions live in small holder processes that run from the build folder that started them, so that folder cannot be
# overwritten while they run. So every deploy builds into a fresh folder (dist-<time>), the daemon is told to step
# aside with its sessions kept (the holders carry them), the UI of the old build is closed, the new build is started
# (it starts its own daemon, which re-attaches to the holders), and build folders nobody uses any more are deleted.
#
# This deploys the 2.0 DEVELOPMENT app only: its own data folder (%APPDATA%\AgentO-2.0-dev), port 47870 and Electron
# profile. The everyday app (the released 1.1 exe on %APPDATA%\AgentO) is never stopped, replaced or touched here.
#
# usage: bash scripts/deploy-keep-sessions.sh        (from the repo root, in Git Bash)
set -u
DEV_DATA="$APPDATA/AgentO-2.0-dev"
mkdir -p "$DEV_DATA"
cd "$(dirname "$0")/.." || exit 1
NEW="dist-$(date +%m%d%H%M)"
echo "building into $NEW"
npx electron-vite build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
npx electron-builder --win --dir -c.directories.output="$NEW" -c.win.signAndEditExecutable=false >/dev/null 2>&1 || { echo "package failed"; exit 1; }
node scripts/set-exe-icon.cjs "$NEW" | tail -1

# the daemon leaves, the sessions stay (killSessions: false)
TMP="$(cygpath -m "${TMPDIR:-/tmp}")"
cat > "$TMP/agento-stop-keep.cjs" <<'EOF'
const WebSocket = require(process.cwd() + '/node_modules/ws');
const fs = require('fs');
const info = JSON.parse(fs.readFileSync(process.env.APPDATA + '/AgentO-2.0-dev/daemon.json', 'utf8'));
const ws = new WebSocket('ws://127.0.0.1:' + info.port);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', token: info.token, client: 'cli' }));
  setTimeout(() => { ws.send(JSON.stringify({ type: 'daemon.shutdown', killSessions: false })); setTimeout(() => process.exit(0), 500); }, 800);
});
ws.on('error', () => process.exit(0));
EOF
node "$TMP/agento-stop-keep.cjs"
sleep 3

# close the old UI windows only (not holders, not a daemon)
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*AgentO\\dist*win-unpacked*' -and \$_.CommandLine -notlike '*\\$NEW\\*' -and \$_.CommandLine -notmatch 'daemon.index.js|holder.index.js' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
sleep 2

# the Claude Code shell exports variables that stop Electron from starting as an app
powershell -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue; \$env:AGENTO_DATA_DIR='$(cygpath -w "$DEV_DATA")'; \$env:ASM_PORT='47870'; Start-Process '$(cygpath -w "$PWD")\\$NEW\\win-unpacked\\AgentO.exe' -ArgumentList '--user-data-dir=$(cygpath -w "$DEV_DATA")'"
sleep 15
grep "daemon starting" "$DEV_DATA/daemon.log" | tail -1

# delete build folders nobody runs from any more
for d in dist dist-*; do
  [ -d "$d" ] || continue
  [ "$d" = "$NEW" ] && continue
  n=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*AgentO\\$d\\win-unpacked*' }).Count")
  if [ "${n:-0}" = "0" ]; then rm -rf "$d" && echo "removed $d"; else echo "kept $d ($n processes still use it)"; fi
done
echo "done: $NEW"

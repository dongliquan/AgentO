// Puts build/icon.ico into AgentO.exe of the given unpacked build folders (default: dist).
//
// `electron-builder --dir -c.win.signAndEditExecutable=false` skips the exe's resource editing, so the exe keeps
// Electron's icon — and the taskbar shows the icon of the exe its pinned shortcut points at (a build under dist/).
// Run after such a build:  node scripts/set-exe-icon.cjs dist dist-b
// A full `npm run dist:win` needs no help: electron-builder sets the icon itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache', 'winCodeSign');
const rcedit = fs.existsSync(cache)
  ? fs
      .readdirSync(cache)
      .map((d) => path.join(cache, d, 'rcedit-x64.exe'))
      .find((p) => fs.existsSync(p))
  : undefined;
if (!rcedit) {
  console.error('rcedit-x64.exe not found in the electron-builder cache (build once with electron-builder first)');
  process.exit(1);
}

const folders = process.argv.slice(2);
for (const d of folders.length ? folders : ['dist']) {
  const exe = path.join(root, d, 'win-unpacked', 'AgentO.exe');
  if (!fs.existsSync(exe)) {
    console.log(`${d}: no AgentO.exe`);
    continue;
  }
  const r = spawnSync(rcedit, [exe, '--set-icon', path.join(root, 'build', 'icon.ico')], { encoding: 'utf8' });
  console.log(`${d}: ${r.status === 0 ? 'icon set' : `failed (exit ${r.status}) — is it running? ${r.stderr || ''}`.trim()}`);
}

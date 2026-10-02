/**
 * Per-user data directory (daemon.json, asm.db, logs). Pure Node — used by main and the daemon, never the renderer.
 *
 * The folder was renamed from "agent-session-manager" to "AgentO" (2026-09-30). The Electron userData folder has the
 * same name, so existing data is migrated file by file instead of renaming the directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_DIR_NAME = 'AgentO';
const LEGACY_DIR_NAME = 'agent-session-manager';

function baseDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') return process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  const xdg = process.env['XDG_CONFIG_HOME'];
  return xdg && xdg.trim() ? xdg : path.join(home, '.config');
}

let migrated = false;

/** Move entries of the legacy folder that the new one doesn't have yet; drop the legacy folder once empty. */
function migrateLegacy(target: string): void {
  if (migrated) return;
  migrated = true;
  const legacy = path.join(baseDir(), LEGACY_DIR_NAME);
  if (!fs.existsSync(legacy)) return;
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const dst = path.join(target, name);
      if (fs.existsSync(dst)) continue;
      try {
        fs.renameSync(path.join(legacy, name), dst);
      } catch {
        /* locked by a still-running old daemon: leave it; the next start retries */
        migrated = false;
      }
    }
    if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy);
  } catch {
    migrated = false;
  }
}

export function dataDir(): string {
  const env = process.env['AGENTO_DATA_DIR'] || process.env['ASM_DATA_DIR'];
  if (env && env.trim()) return path.resolve(env);
  const dir = path.join(baseDir(), APP_DIR_NAME);
  migrateLegacy(dir);
  return dir;
}

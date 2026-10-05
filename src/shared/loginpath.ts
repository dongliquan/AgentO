/**
 * macOS: an app started from Finder / the Dock (and the daemon it spawns) gets launchd's minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so Homebrew, nvm, npm -g, ~/.local/bin and the agent CLIs installed there are
 * invisible. Ask the user's login shell for its PATH once and merge it into process.env. Pure Node — used by main and
 * the daemon. No-op on other platforms or when the shell does not answer in time.
 */
import { spawnSync } from 'node:child_process';

const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export function loginShellPath(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const shell = process.env['SHELL'] || '/bin/zsh';
  try {
    // -l: login (zprofile / bash_profile, where PATH is usually set); -i: interactive (zshrc, nvm/volta hooks)
    const res = spawnSync(shell, ['-ilc', 'command printf "%s" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ELECTRON_RUN_AS_NODE: '' }
    });
    if (res.status !== 0 || !res.stdout) return undefined;
    // the shell may print banners first: take the last line that looks like a PATH
    const line = res.stdout.split('\n').reverse().find((l) => l.includes('/'));
    return line?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Merges the login shell's PATH into process.env.PATH (login entries first, current ones kept). Returns the result. */
export function fixPathFromLoginShell(): string {
  const current = process.env['PATH'] || '';
  const fromShell = loginShellPath();
  if (!fromShell) return current;
  const merged: string[] = [];
  for (const d of [...fromShell.split(':'), ...current.split(':')]) {
    if (d && !merged.includes(d)) merged.push(d);
  }
  // keep launchd's defaults at the end so nothing that used to resolve stops resolving
  for (const d of LAUNCHD_PATH.split(':')) if (!merged.includes(d)) merged.push(d);
  process.env['PATH'] = merged.join(':');
  return process.env['PATH'];
}

/**
 * Agents › Connections: for each agent CLI AgentO drives (Claude Code, Codex, Gemini CLI) — is it installed (on the
 * PATH), which version, and is it signed in. Sign-in is the CLI's own (its files under the home folder); AgentO keeps
 * no credentials, it only looks whether they are there.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { AgentConnection, AgentKind } from '@shared/protocol';
import { getAgentDef, resolveCommand } from './agents';

const VERSION_TIMEOUT_MS = 8000;

function version(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    // .cmd / .bat shims (npm installs) only run through the shell on Windows
    const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    execFile(cmd, ['--version'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true, shell, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }, (err, stdout) => {
      if (err) return resolve(undefined);
      const line = stdout.split(/\r?\n/).find((l) => l.trim());
      resolve(line?.trim().slice(0, 80));
    });
  });
}

const home = os.homedir();
const exists = (...p: string[]): boolean => fs.existsSync(path.join(...p));

/** true / false when the CLI's sign-in files say so; null when it cannot be told from here (e.g. macOS keychain). */
function signedIn(kind: AgentKind): boolean | null {
  if (kind === 'claude') {
    const dir = process.env['CLAUDE_CONFIG_DIR'] || path.join(home, '.claude');
    if (exists(dir, '.credentials.json')) return true;
    return process.platform === 'darwin' ? null : false; // macOS keeps it in the keychain
  }
  if (kind === 'codex') return exists(process.env['CODEX_HOME'] || path.join(home, '.codex'), 'auth.json');
  if (kind === 'gemini') return exists(home, '.gemini', 'oauth_creds.json') || !!process.env['GEMINI_API_KEY'];
  return null;
}

const NOTES: Partial<Record<AgentKind, string>> = {
  codex: 'Sign in with a ChatGPT plan (Plus, Pro, Team…). Used for coaches; coding stays on Claude.',
  gemini:
    'Personal Google plans (free, AI Pro, Ultra) can no longer use Gemini CLI since 2026-06-18 — it needs Gemini Code ' +
    'Assist Standard / Enterprise (or a paid API key).'
};

export const CONNECTABLE: AgentKind[] = ['claude', 'codex', 'gemini'];

export async function agentConnections(): Promise<AgentConnection[]> {
  return Promise.all(
    CONNECTABLE.map(async (kind) => {
      const def = getAgentDef(kind);
      const where = resolveCommand(def.command);
      const v = where ? await version(where) : undefined;
      return {
        kind,
        label: kind === 'codex' ? 'ChatGPT (Codex)' : def.label,
        installed: !!where,
        ...(where ? { path: where } : {}),
        ...(v ? { version: v } : {}),
        signedIn: where ? signedIn(kind) : null,
        ...(NOTES[kind] ? { note: NOTES[kind] } : {})
      };
    })
  );
}

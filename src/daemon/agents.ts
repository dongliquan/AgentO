/**
 * Agent definitions and command resolution.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentDef, AgentKind } from '@shared/protocol';
import type { AgentDefEx } from '@shared/extra';

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] || 'cmd.exe';
  return process.env['SHELL'] || '/bin/bash';
}

export const AGENT_DEFS: AgentDef[] = [
  {
    kind: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: [],
    resumeArgs: ['--resume', '{id}'],
    // Claude Code does not print its session id; resumeId is discovered from ~/.claude/projects after exit.
    color: '#d97757'
  },
  {
    kind: 'codex',
    label: 'Codex',
    command: 'codex',
    args: [],
    resumeArgs: ['resume', '{id}'],
    color: '#10a37f'
  },
  {
    kind: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    args: [],
    resumeArgs: ['--resume', '{id}'],
    color: '#4285f4'
  },
  {
    kind: 'ollama',
    label: 'Ollama',
    command: 'ollama',
    args: ['run', 'llama3.2'],
    color: '#8b8b8b'
  },
  {
    kind: 'shell',
    label: 'Shell',
    command: defaultShell(),
    args: [],
    color: '#6e7681'
  },
  {
    kind: 'custom',
    label: 'Custom',
    command: '',
    args: [],
    color: '#a371f7'
  }
];

export function getAgentDef(kind: AgentKind): AgentDef {
  return AGENT_DEFS.find((a) => a.kind === kind) ?? AGENT_DEFS[AGENT_DEFS.length - 1]!;
}

/* ---------- command resolution ---------- */

function isExecutableFile(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirs(): string[] {
  const raw = process.env['PATH'] || process.env['Path'] || '';
  const dirs = raw.split(path.delimiter).filter(Boolean);
  // Common locations that GUI-launched processes on macOS/Linux miss.
  if (process.platform !== 'win32') {
    const home = os.homedir();
    for (const extra of [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, '.cargo', 'bin')
    ]) {
      if (!dirs.includes(extra) && fs.existsSync(extra)) dirs.push(extra);
    }
  } else {
    const appData = process.env['APPDATA'];
    if (appData) {
      const npmDir = path.join(appData, 'npm');
      if (!dirs.includes(npmDir) && fs.existsSync(npmDir)) dirs.push(npmDir);
    }
  }
  return dirs;
}

/**
 * Resolve a command name to an absolute path using `where`/`which` semantics.
 * On win32 tries `<cmd>.cmd`, `<cmd>.exe`, `<cmd>` (plus PATHEXT) — npm CLIs are .cmd shims.
 * Returns undefined if not found. Absolute/relative paths are returned as-is when they exist.
 */
export function resolveCommand(cmd: string): string | undefined {
  if (!cmd) return undefined;
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    if (isExecutableFile(cmd)) return cmd;
    if (process.platform === 'win32') {
      for (const ext of ['.cmd', '.exe', '.bat']) if (isExecutableFile(cmd + ext)) return cmd + ext;
    }
    return undefined;
  }
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const hasExt = path.extname(cmd) !== '';
    if (hasExt) candidates.push(cmd);
    else {
      candidates.push(`${cmd}.cmd`, `${cmd}.exe`, cmd);
      const pathext = (process.env['PATHEXT'] || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
      for (const e of pathext) {
        const c = cmd + e.toLowerCase();
        if (!candidates.includes(c)) candidates.push(c);
      }
    }
  } else {
    candidates.push(cmd);
  }
  for (const dir of pathDirs()) {
    for (const c of candidates) {
      const full = path.join(dir, c);
      if (isExecutableFile(full)) return full;
    }
  }
  return undefined;
}

/** Returns agent defs with `available` set from a PATH lookup. */
export function detectAgents(): AgentDefEx[] {
  return AGENT_DEFS.map((def) => {
    if (def.kind === 'custom') return { ...def, available: true };
    const resolved = resolveCommand(def.command);
    return { ...def, available: resolved !== undefined };
  });
}

/* ---------- Claude Code resume id discovery ---------- */

/** Claude Code encodes a cwd into a project dir name by replacing every non-alphanumeric char with '-'. */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Best-effort: newest transcript (.jsonl) under ~/.claude/projects/<encoded cwd>/ whose mtime is after `since`.
 * Returns its basename (the Claude session id) or undefined.
 */
export function findClaudeResumeId(cwd: string, since?: number): string | undefined {
  try {
    const home = os.homedir();
    const configDir = process.env['CLAUDE_CONFIG_DIR'] || path.join(home, '.claude');
    const projectsDir = path.join(configDir, 'projects');
    const candidates = new Set<string>([path.join(projectsDir, claudeProjectDirName(cwd))]);
    // Also try the real path (symlinks) and a trailing-slash-free variant.
    try {
      candidates.add(path.join(projectsDir, claudeProjectDirName(fs.realpathSync(cwd))));
    } catch {
      /* ignore */
    }
    let best: { id: string; mtime: number } | undefined;
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        const full = path.join(dir, name);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (since && st.mtimeMs < since - 5_000) continue;
        if (!best || st.mtimeMs > best.mtime) best = { id: name.slice(0, -'.jsonl'.length), mtime: st.mtimeMs };
      }
    }
    return best?.id;
  } catch {
    return undefined;
  }
}

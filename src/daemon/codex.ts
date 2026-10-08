import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatEntry, ChatTool } from '@shared/protocol';

/**
 * Codex CLI conversations: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl. AgentO finds a running Codex
 * session's id from it (to hibernate / resume, `codex resume <id>`), shows it as a chat like Claude's, takes the last
 * reply for team reports, and the conversation size from its token counts.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clip = (s: string, n = 4000): string => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s);

function sessionsDir(): string {
  return path.join(process.env['CODEX_HOME'] || path.join(os.homedir(), '.codex'), 'sessions');
}

/** day folders, newest first (today and the days before) */
function dayDirs(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    out.push(path.join(sessionsDir(), String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')));
  }
  return out;
}

const found = new Map<string, string>();

/** The rollout file of a Codex session id (looked up in the last 60 days, then remembered). */
export function findCodexRollout(id: string): string | undefined {
  const hit = found.get(id);
  if (hit && fs.existsSync(hit)) return hit;
  for (const dir of dayDirs(60)) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const name = names.find((n) => n.endsWith(`-${id}.jsonl`));
    if (name) {
      const p = path.join(dir, name);
      found.set(id, p);
      return p;
    }
  }
  return undefined;
}

const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

/** The id of the Codex session started in `cwd` since `since` (ms): the newest rollout whose first record says so. */
export function discoverCodexId(cwd: string, since: number, taken: Set<string>): string | undefined {
  const want = norm(cwd);
  let best: { id: string; at: number } | undefined;
  for (const dir of dayDirs(2)) {
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.mtimeMs < since - 5_000) continue;
      const meta = firstLine(p);
      const pl = meta && isObj(meta['payload']) ? meta['payload'] : undefined;
      const id = pl ? str(pl['id']) || str(pl['session_id']) : '';
      if (!id || taken.has(id) || !pl || norm(str(pl['cwd'])) !== want) continue;
      const at = Date.parse(str(pl['timestamp'])) || st.birthtimeMs;
      if (at < since - 60_000) continue;
      if (!best || at > best.at) best = { id, at };
    }
  }
  if (best) found.delete(best.id);
  return best?.id;
}

function firstLine(p: string): Json | undefined {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const line = buf.subarray(0, n).toString('utf8').split('\n')[0] ?? '';
      const o = JSON.parse(line) as unknown;
      return isObj(o) ? o : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.map((c) => (isObj(c) ? str(c['text']) : '')).filter(Boolean).join('\n').trim() : '';

/** Codex rollout records → the same chat entries the Claude transcript gives. */
export class CodexParser {
  readonly entries: ChatEntry[] = [];
  private byId = new Map<string, ChatEntry>();
  /** tokens the latest call carried (input incl. cached) */
  context: number | undefined;

  feed(o: Json): ChatEntry[] {
    const p = isObj(o['payload']) ? o['payload'] : undefined;
    if (!p) return [];
    const ts = Date.parse(str(o['timestamp'])) || Date.now();
    if (o['type'] === 'event_msg' && p['type'] === 'token_count') {
      const info = isObj(p['info']) ? p['info'] : undefined;
      const last = info && isObj(info['last_token_usage']) ? info['last_token_usage'] : undefined;
      const n = last ? Number(last['input_tokens'] ?? 0) : 0;
      if (n > 0) this.context = n;
      return [];
    }
    if (o['type'] !== 'event_msg' || p['type'] !== 'item_completed' || !isObj(p['item'])) return [];
    const it = p['item'];
    const id = str(it['id']) || `${ts}`;
    const add = (e: ChatEntry): ChatEntry[] => {
      const prev = this.byId.get(e.id);
      if (prev) Object.assign(prev, e);
      else {
        this.entries.push(e);
        this.byId.set(e.id, e);
      }
      return [this.byId.get(e.id)!];
    };
    switch (it['type']) {
      case 'UserMessage': {
        const text = textOf(it['content']);
        return text ? add({ id, ts, kind: 'user', text }) : [];
      }
      case 'AgentMessage': {
        const text = textOf(it['content']);
        return text ? add({ id, ts, kind: 'assistant', text }) : [];
      }
      case 'Reasoning': {
        const text = Array.isArray(it['summary_text']) ? (it['summary_text'] as unknown[]).map(str).join('\n').trim() : '';
        return text ? add({ id, ts, kind: 'thinking', text }) : [];
      }
      case 'CommandExecution': {
        const parsed = Array.isArray(it['parsed_cmd']) ? (it['parsed_cmd'] as unknown[]).map((c) => (isObj(c) ? str(c['cmd']) : '')).filter(Boolean).join(' && ') : '';
        const command = parsed || (Array.isArray(it['command']) ? (it['command'] as unknown[]).map(str).join(' ') : '');
        const out = [str(it['stdout']), str(it['stderr'])].filter((x) => x.trim()).join('\n');
        const tool: ChatTool = { name: 'Bash', input: { command }, done: true, isError: it['status'] === 'failed', result: clip(out) };
        return add({ id, ts, kind: 'tool', tool });
      }
      default: {
        // file edits, MCP / web tools …: shown as a tool with its kind
        const kind = str(it['type']);
        if (!kind || kind === 'Plan' || kind === 'TodoList') return [];
        const input: Record<string, unknown> = {};
        for (const k of ['path', 'server', 'tool', 'query', 'changes']) if (it[k] !== undefined) input[k] = it[k];
        const tool: ChatTool = { name: kind, input, done: true, isError: it['status'] === 'failed', result: clip(str(it['output'] ?? it['result'] ?? '')) };
        return add({ id, ts, kind: 'tool', tool });
      }
    }
  }
}

/** Parse a whole rollout tail (team reports, context size). */
export function readCodex(file: string, maxBytes = 4 * 1024 * 1024): CodexParser {
  const parser = new CodexParser();
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as unknown;
          if (isObj(o)) parser.feed(o);
        } catch {
          /* partial line */
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* unreadable */
  }
  return parser;
}

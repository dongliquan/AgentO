/**
 * Token usage report: what every Claude session spent, read from Claude Code's own transcripts
 * (~/.claude/projects/<dir>/<session-id>.jsonl, each assistant message carries `usage`).
 *
 * AgentO sessions are matched by their pinned Claude session id (Session.resumeId); everything else in the transcripts
 * folder is "outside AgentO" (VS Code, a terminal), grouped by its working-folder directory. Files are parsed
 * incrementally (byte offset per file), so asking again only reads what was appended since.
 * Also collected per session: the AgentO team tools it called (mcp__agento__*) and the size of their results, the
 * team messages it received, and other tools' result sizes — what fills a context and so drives the cost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageBucket, UsageReport, UsageSessionInfo } from '@shared/protocol';

const HOUR = 3600_000;

interface Msg {
  ts: number;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface FileState {
  size: number;
  offset: number;
  rest: string;
  seen: Set<string>;
  msgs: Msg[];
  /** tool name → [calls, result bytes] */
  tools: Map<string, [number, number]>;
  pendingTools: Map<string, string>;
  teamMsgs: number;
  teamMsgBytes: number;
  maxCtx: number;
  lastCtx: number;
}

const files = new Map<string, FileState>();

function projectsDir(): string {
  return path.join(process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude'), 'projects');
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function isTeamText(t: string): boolean {
  return t.startsWith('[AgentO]') || t.startsWith('[Order from') || t.startsWith('[New project]') || t.startsWith('[Organize the team]');
}

function parseLine(st: FileState, line: string): void {
  let j: Json;
  try {
    j = JSON.parse(line) as Json;
  } catch {
    return;
  }
  const m = isObj(j['message']) ? j['message'] : undefined;
  if (!m) return;
  if (j['type'] === 'assistant') {
    const u = isObj(m['usage']) ? m['usage'] : undefined;
    const id = typeof m['id'] === 'string' ? m['id'] : '';
    const model = typeof m['model'] === 'string' ? m['model'] : '';
    // one API message is written as several lines (one per content block), each with the same usage: count it once
    if (u && model !== '<synthetic>' && (!id || !st.seen.has(id))) {
      if (id) st.seen.add(id);
      const ts = Date.parse(String(j['timestamp'] ?? '')) || 0;
      const msg: Msg = { ts, model, input: n(u['input_tokens']), output: n(u['output_tokens']), cacheWrite: n(u['cache_creation_input_tokens']), cacheRead: n(u['cache_read_input_tokens']) };
      st.msgs.push(msg);
      const ctx = msg.input + msg.cacheWrite + msg.cacheRead;
      st.lastCtx = ctx;
      if (ctx > st.maxCtx) st.maxCtx = ctx;
    }
    const content = Array.isArray(m['content']) ? m['content'] : [];
    for (const c of content) {
      if (isObj(c) && c['type'] === 'tool_use' && typeof c['id'] === 'string') st.pendingTools.set(c['id'], String(c['name'] ?? '?'));
    }
    return;
  }
  if (j['type'] === 'user') {
    const content = m['content'];
    if (typeof content === 'string') {
      if (isTeamText(content)) {
        st.teamMsgs++;
        st.teamMsgBytes += content.length;
      }
      return;
    }
    if (!Array.isArray(content)) return;
    for (const c of content) {
      if (!isObj(c)) continue;
      if (c['type'] === 'tool_result' && typeof c['tool_use_id'] === 'string') {
        const name = st.pendingTools.get(c['tool_use_id']);
        if (!name) continue;
        st.pendingTools.delete(c['tool_use_id']);
        const bytes = JSON.stringify(c['content'] ?? '').length;
        const cur = st.tools.get(name) ?? [0, 0];
        st.tools.set(name, [cur[0] + 1, cur[1] + bytes]);
      } else if (c['type'] === 'text' && typeof c['text'] === 'string' && isTeamText(c['text'])) {
        st.teamMsgs++;
        st.teamMsgBytes += c['text'].length;
      }
    }
  }
}

/** Reads what was appended to a transcript since the last call. */
function update(file: string): FileState | undefined {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return undefined;
  }
  let st = files.get(file);
  if (!st || size < st.size) {
    st = { size: 0, offset: 0, rest: '', seen: new Set(), msgs: [], tools: new Map(), pendingTools: new Map(), teamMsgs: 0, teamMsgBytes: 0, maxCtx: 0, lastCtx: 0 };
    files.set(file, st);
  }
  if (size === st.offset) return st;
  const fd = fs.openSync(file, 'r');
  try {
    const CHUNK = 8 * 1024 * 1024;
    while (st.offset < size) {
      const len = Math.min(CHUNK, size - st.offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.offset);
      st.offset += len;
      const text = st.rest + buf.toString('utf8');
      const lines = text.split('\n');
      st.rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) parseLine(st, line);
    }
  } finally {
    fs.closeSync(fd);
  }
  st.size = size;
  return st;
}

/** "-Users-me-work-shop" → "shop" (the last part of the encoded working folder). */
function dirLabel(dir: string): string {
  const parts = dir.split('-').filter(Boolean);
  return parts.slice(-2).join('-') || dir;
}

export interface ReportSession {
  id: string;
  resumeId?: string;
  title: string;
  role: string;
  agent: string;
  projectId: string;
}

/**
 * The report for the last `days` days: hourly buckets per session (AgentO) or per transcripts folder (outside), plus
 * per-session details for the sessions active in the range.
 */
export function usageReport(sessions: ReportSession[], days: number, includeOutside: boolean): UsageReport {
  const since = Date.now() - Math.max(1, days) * 24 * HOUR;
  const root = projectsDir();
  const byResume = new Map(sessions.filter((s) => s.resumeId).map((s) => [s.resumeId!, s]));
  const buckets = new Map<string, UsageBucket>();
  const infos: UsageSessionInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    /* no transcripts */
  }
  for (const d of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(root, d, name);
      const s = byResume.get(name.slice(0, -'.jsonl'.length));
      if (!s && !includeOutside) continue;
      try {
        if (fs.statSync(full).mtimeMs < since) continue;
      } catch {
        continue;
      }
      const st = update(full);
      if (!st) continue;
      const key = s ? s.id : `outside:${d}`;
      let turns = 0;
      for (const m of st.msgs) {
        if (m.ts < since) continue;
        turns++;
        const hour = Math.floor(m.ts / HOUR) * HOUR;
        const bk = `${key}|${hour}|${m.model}`;
        const b = buckets.get(bk) ?? { key, hour, model: m.model, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, turns: 0 };
        b.input += m.input;
        b.output += m.output;
        b.cacheWrite += m.cacheWrite;
        b.cacheRead += m.cacheRead;
        b.turns++;
        buckets.set(bk, b);
      }
      if (turns === 0) continue;
      if (s) {
        infos.push({
          key,
          title: s.title,
          role: s.role,
          agent: s.agent,
          projectId: s.projectId,
          maxContext: st.maxCtx,
          lastContext: st.lastCtx,
          teamMessages: st.teamMsgs,
          teamMessageBytes: st.teamMsgBytes,
          tools: [...st.tools].map(([tool, [calls, bytes]]) => ({ tool, calls, bytes })).sort((a, b) => b.bytes - a.bytes)
        });
      } else if (!infos.some((i) => i.key === key)) {
        infos.push({ key, title: dirLabel(d), role: 'outside', agent: 'claude', projectId: '', maxContext: st.maxCtx, lastContext: st.lastCtx, teamMessages: 0, teamMessageBytes: 0, tools: [] });
      } else {
        const i = infos.find((x) => x.key === key)!;
        i.maxContext = Math.max(i.maxContext, st.maxCtx);
      }
    }
  }
  return { generatedAt: Date.now(), since, days, buckets: [...buckets.values()], sessions: infos };
}

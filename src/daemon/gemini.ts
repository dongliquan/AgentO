import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatEntry, ChatTool } from '@shared/protocol';

/**
 * Gemini CLI conversations: ~/.gemini/tmp/<project slug>/chats/session-<time>-<id8>.jsonl (the slug of a working folder is
 * in ~/.gemini/projects.json). A session started with `--session-id <uuid>` writes its file under that id, so AgentO
 * knows it from the start; it is shown as a chat like Claude's, and resumed with `--resume <number>` (its place in the
 * folder's session list, oldest first).
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clip = (s: string, n = 4000): string => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s);

const geminiHome = (): string => path.join(os.homedir(), '.gemini');
const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

/** The folder the CLI keeps this working folder's chats in (null while it has not made one yet). */
function chatsDir(cwd: string): string | null {
  try {
    const map = (JSON.parse(fs.readFileSync(path.join(geminiHome(), 'projects.json'), 'utf8')) as { projects?: Record<string, string> }).projects ?? {};
    const want = norm(cwd);
    for (const [k, slug] of Object.entries(map)) if (norm(k) === want) return path.join(geminiHome(), 'tmp', slug, 'chats');
  } catch {
    /* none yet */
  }
  return null;
}

interface ChatFile {
  file: string;
  id: string;
  start: number;
}

/** The folder's main conversations, oldest first (the CLI's own numbering for --resume). */
function listChats(cwd: string): ChatFile[] {
  const dir = chatsDir(cwd);
  if (!dir) return [];
  const out: ChatFile[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^session-.*\.jsonl?$/.test(n));
  } catch {
    return [];
  }
  for (const n of names) {
    const file = path.join(dir, n);
    const head = firstLine(file);
    if (!head || !str(head['sessionId']) || (head['kind'] && head['kind'] !== 'main')) continue;
    out.push({ file, id: str(head['sessionId']), start: Date.parse(str(head['startTime'])) || 0 });
  }
  return out.sort((a, b) => a.start - b.start);
}

function firstLine(p: string): Json | undefined {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(8 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const o = JSON.parse(buf.subarray(0, n).toString('utf8').split('\n')[0] ?? '') as unknown;
      return isObj(o) ? o : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

const found = new Map<string, string>();

/** The chat file of a Gemini session id in its working folder. */
export function findGeminiChat(cwd: string, id: string): string | undefined {
  const hit = found.get(id);
  if (hit && fs.existsSync(hit)) return hit;
  const f = listChats(cwd).find((c) => c.id === id);
  if (f) found.set(id, f.file);
  return f?.file;
}

/** The id of the Gemini session started in `cwd` since `since` (ms): the newest chat of the folder that began then. */
export function discoverGeminiId(cwd: string, since: number, taken: Set<string>): string | undefined {
  const mine = listChats(cwd).filter((c) => !taken.has(c.id) && c.start >= since - 60_000);
  return mine[mine.length - 1]?.id;
}

/** The number `gemini --resume` takes for a session (1 = oldest in the folder); undefined when it has no chat file yet. */
export function geminiResumeIndex(cwd: string, id: string): number | undefined {
  const i = listChats(cwd).findIndex((c) => c.id === id);
  return i < 0 ? undefined : i + 1;
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content.trim();
  return Array.isArray(content) ? content.map((c) => (isObj(c) ? str(c['text']) : typeof c === 'string' ? c : '')).filter(Boolean).join('\n').trim() : '';
};

/** Gemini chat records → the same chat entries the Claude transcript gives. */
export class GeminiParser {
  readonly entries: ChatEntry[] = [];
  private byId = new Map<string, ChatEntry>();
  /** tokens the latest call carried */
  context: number | undefined;
  model: string | undefined;

  private add(e: ChatEntry): ChatEntry {
    const prev = this.byId.get(e.id);
    if (prev) {
      Object.assign(prev, e);
      return prev;
    }
    this.entries.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  feed(o: Json): ChatEntry[] {
    const type = str(o['type']);
    if (!type) return []; // the header line and {"$set": …} updates
    const id = str(o['id']) || `${str(o['timestamp'])}-${type}`;
    const ts = Date.parse(str(o['timestamp'])) || Date.now();
    const out: ChatEntry[] = [];
    if (type === 'user') {
      const text = textOf(o['content']);
      // the first record is the CLI's own context message (date, system, folder listing), not something typed
      if (text && !text.startsWith('<session_context>')) out.push(this.add({ id, ts, kind: 'user', text }));
    } else if (type === 'gemini') {
      const thoughts = Array.isArray(o['thoughts']) ? (o['thoughts'] as unknown[]) : [];
      const think = thoughts.map((t) => (isObj(t) ? [str(t['subject']), str(t['description'])].filter(Boolean).join(': ') : '')).filter(Boolean).join('\n');
      if (think) out.push(this.add({ id: `${id}:think`, ts, kind: 'thinking', text: think }));
      const calls = Array.isArray(o['toolCalls']) ? (o['toolCalls'] as unknown[]) : [];
      calls.forEach((c, i) => {
        if (!isObj(c)) return;
        const result = Array.isArray(c['result'])
          ? (c['result'] as unknown[]).map((r) => (isObj(r) && isObj(r['functionResponse']) ? JSON.stringify((r['functionResponse'] as Json)['response']) : '')).filter(Boolean).join('\n')
          : str(c['resultDisplay']) || str(c['result']);
        const tool: ChatTool = {
          name: str(c['displayName']) || str(c['name']) || 'tool',
          input: isObj(c['args']) ? c['args'] : {},
          done: c['status'] !== 'executing' && c['status'] !== 'pending',
          isError: c['status'] === 'error' || c['status'] === 'failed',
          ...(result ? { result: clip(result) } : {})
        };
        out.push(this.add({ id: str(c['id']) || `${id}:tool${i}`, ts, kind: 'tool', tool }));
      });
      const text = textOf(o['content']);
      if (text) out.push(this.add({ id, ts, kind: 'assistant', text }));
      const tokens = isObj(o['tokens']) ? o['tokens'] : undefined;
      const n = tokens ? Number(tokens['input'] ?? 0) : 0;
      if (n > 0) this.context = n;
      if (str(o['model'])) this.model = str(o['model']);
    } else if (type === 'error' || type === 'warning' || type === 'info') {
      const text = textOf(o['content']);
      // the sign-in page address the CLI prints is noise in a conversation
      if (text && !/accounts\.google\.com\/o\/oauth2/.test(text)) out.push(this.add({ id, ts, kind: 'system', text: clip(text, 800) }));
    }
    return out;
  }
}

/** Parse a whole chat file tail (team reports, context size, model). */
export function readGemini(file: string, maxBytes = 4 * 1024 * 1024): GeminiParser {
  const parser = new GeminiParser();
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

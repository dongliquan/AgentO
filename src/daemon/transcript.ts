/**
 * Claude Code transcript reader: tails ~/.claude/projects/<encoded cwd>/<session-id>.jsonl and
 * normalizes it into ChatEntry[] for the chat view (VS Code extension-like rendering).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatEntry, ChatTool } from '@shared/protocol';
import { claudeProjectDirName } from './agents';

const MAX_RESULT = 6000;
const MAX_PATCH_LINES = 400;
const POLL_MS = 700;
/** A long transcript (sessions brought in from VS Code reach 100+ MB) is shown from its last few MB only. */
const TAIL_START_MAX = 4 * 1024 * 1024;

function projectsDir(): string {
  return path.join(process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude'), 'projects');
}

/** transcripts found before (a transcript never moves): skips the directory scan on every later lookup */
const found = new Map<string, string>();

/** Locate <id>.jsonl: the encoded-cwd dir first (case-insensitive on Windows), then any project dir. */
export function findTranscript(cwd: string, claudeId: string): string | undefined {
  const hit = found.get(claudeId);
  if (hit && fs.existsSync(hit)) return hit;
  const p = scanTranscript(cwd, claudeId);
  if (p) found.set(claudeId, p);
  return p;
}

function scanTranscript(cwd: string, claudeId: string): string | undefined {
  const root = projectsDir();
  const file = `${claudeId}.jsonl`;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  const want = claudeProjectDirName(cwd).toLowerCase();
  const ordered = [...dirs.filter((d) => d.toLowerCase() === want), ...dirs.filter((d) => d.toLowerCase() !== want)];
  for (const d of ordered) {
    const p = path.join(root, d, file);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** The whole lines of the last `maxBytes` of a transcript (all of it when it is shorter). */
export function readTranscriptLines(file: string, maxBytes = TAIL_START_MAX): string[] {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text.split('\n').filter((l) => l.trim());
  } finally {
    fs.closeSync(fd);
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clip = (s: string, n = MAX_RESULT): string => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more chars)` : s);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isObj(c) ? (c['type'] === 'text' ? str(c['text']) : c['type'] === 'image' ? '[image]' : '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function patchFrom(toolUseResult: unknown, input: Json, name: string): string[] | undefined {
  if (isObj(toolUseResult) && Array.isArray(toolUseResult['structuredPatch'])) {
    const lines: string[] = [];
    for (const h of toolUseResult['structuredPatch'] as unknown[]) {
      if (!isObj(h) || !Array.isArray(h['lines'])) continue;
      if (lines.length) lines.push('@@');
      for (const l of h['lines'] as unknown[]) if (typeof l === 'string') lines.push(l);
    }
    if (lines.length) return lines.slice(0, MAX_PATCH_LINES);
  }
  if (name === 'Write' && typeof input['content'] === 'string') {
    return (input['content'] as string).split('\n').slice(0, MAX_PATCH_LINES).map((l) => `+${l}`);
  }
  if (name === 'Edit' && typeof input['old_string'] === 'string' && typeof input['new_string'] === 'string') {
    const out = [
      ...(input['old_string'] as string).split('\n').map((l) => `-${l}`),
      ...(input['new_string'] as string).split('\n').map((l) => `+${l}`)
    ];
    return out.slice(0, MAX_PATCH_LINES);
  }
  return undefined;
}

/** User text that is harness plumbing rather than something the person typed. */
function userTextToEntryText(t: string): { kind: 'user' | 'system'; text: string } | null {
  const s = t.trim();
  if (!s) return null;
  if (s.startsWith('<system-reminder>') || s.startsWith('<local-command-caveat>')) return null;
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(s);
  if (cmd) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(s)?.[1]?.trim();
    return { kind: 'user', text: `${cmd[1]!.trim()}${args ? ` ${args}` : ''}` };
  }
  const out = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(s);
  if (out) return out[1]!.trim() ? { kind: 'system', text: out[1]!.trim() } : null;
  if (s.startsWith('[Request interrupted')) return { kind: 'system', text: 'Interrupted' };
  return { kind: 'user', text: s };
}

export class TranscriptParser {
  readonly entries: ChatEntry[] = [];
  private byId = new Map<string, ChatEntry>();

  /** Feed one JSONL record; returns entries created or changed by it. */
  feed(o: Json): ChatEntry[] {
    if (o['isSidechain'] === true) return [];
    const type = o['type'];
    if (type !== 'user' && type !== 'assistant') return [];
    const msg = o['message'];
    if (!isObj(msg)) return [];
    const ts = Date.parse(str(o['timestamp'])) || Date.now();
    const uuid = str(o['uuid']) || `${ts}`;
    const content = msg['content'];
    const changed: ChatEntry[] = [];
    const add = (e: ChatEntry): void => {
      const prev = this.byId.get(e.id);
      if (prev) Object.assign(prev, e);
      else {
        this.entries.push(e);
        this.byId.set(e.id, e);
      }
      changed.push(this.byId.get(e.id)!);
    };

    if (type === 'user') {
      if (o['isMeta'] === true) return [];
      if (typeof content === 'string') {
        const t = userTextToEntryText(content);
        if (t) add({ id: uuid, ts, kind: t.kind, text: t.text });
        return changed;
      }
      if (!Array.isArray(content)) return [];
      let text = '';
      let images = 0;
      for (const c of content) {
        if (!isObj(c)) continue;
        if (c['type'] === 'tool_result') {
          const tool = this.byId.get(str(c['tool_use_id']));
          if (tool?.tool) {
            tool.tool.done = true;
            tool.tool.isError = c['is_error'] === true;
            tool.tool.result = clip(resultText(c['content']));
            const patch = patchFrom(o['toolUseResult'], tool.tool.input, tool.tool.name);
            if (patch) tool.tool.patch = patch;
            changed.push(tool);
          }
        } else if (c['type'] === 'text') text += (text ? '\n' : '') + str(c['text']);
        else if (c['type'] === 'image') images++;
      }
      const t = userTextToEntryText(text);
      if (t || images) add({ id: uuid, ts, kind: t?.kind ?? 'user', text: t?.text ?? '', ...(images ? { images } : {}) });
      return changed;
    }

    // assistant: each JSONL line usually carries one content block
    if (!Array.isArray(content)) return [];
    content.forEach((c, i) => {
      if (!isObj(c)) return;
      const id = content.length > 1 ? `${uuid}:${i}` : uuid;
      if (c['type'] === 'text') {
        const t = str(c['text']).trim();
        if (t) add({ id, ts, kind: 'assistant', text: t });
      } else if (c['type'] === 'thinking') {
        const t = str(c['thinking']).trim();
        if (t) add({ id, ts, kind: 'thinking', text: t });
      } else if (c['type'] === 'tool_use') {
        const tool: ChatTool = { name: str(c['name']), input: isObj(c['input']) ? c['input'] : {}, done: false };
        add({ id: str(c['id']) || id, ts, kind: 'tool', tool });
      }
    });
    return changed;
  }
}

/** Tails one transcript file, reporting newly parsed/changed entries. */
/** What a tail feeds: Claude's transcript parser, or Codex's rollout parser (codex.ts). */
export interface ChatParser {
  readonly entries: ChatEntry[];
  feed(o: Json): ChatEntry[];
}

export class TranscriptTail {
  private offset = 0;
  private rest = '';
  private timer: NodeJS.Timeout | null = null;
  file: string | undefined;

  constructor(
    private locate: () => string | undefined,
    private onChange: (entries: ChatEntry[]) => void,
    readonly parser: ChatParser = new TranscriptParser()
  ) {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  private poll(): void {
    if (!this.file) {
      this.file = this.locate();
      if (!this.file) return;
    }
    let size: number;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // truncated/rewritten: start over
      this.offset = 0;
      this.rest = '';
    }
    if (size === this.offset) return;
    let partial = false;
    if (this.offset === 0 && size > TAIL_START_MAX) {
      this.offset = size - TAIL_START_MAX;
      partial = true; // starts mid-line: drop up to the first newline
    }
    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      let text = this.rest + buf.toString('utf8');
      if (partial) text = text.slice(text.indexOf('\n') + 1);
      const lines = text.split('\n');
      this.rest = lines.pop() ?? '';
      const changed = new Map<string, ChatEntry>();
      for (const line of lines) {
        if (!line.trim()) continue;
        let o: unknown;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (isObj(o)) for (const e of this.parser.feed(o)) changed.set(e.id, e);
      }
      if (changed.size) this.onChange([...changed.values()]);
    } finally {
      fs.closeSync(fd);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

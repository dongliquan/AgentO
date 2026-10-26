import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { log } from './log';

/**
 * A headless Claude Code process (`claude -p --input-format stream-json --output-format stream-json`): user
 * messages go in as JSON lines on stdin, everything it does comes out as JSON events on stdout — the turn's start
 * and end, its text and tool calls, usage. Nothing is typed into a screen and nothing is read off one. The
 * conversation is still written to the transcript file, so the chat view and the token report work as for a TUI
 * session. Permission questions reach AgentO through the MCP `permission` tool (--permission-prompt-tool).
 */
export type StreamJson = Record<string, unknown>;

export interface StreamHandlers {
  event: (j: StreamJson) => void;
  /** stderr text (startup errors, warnings) */
  stderr: (text: string) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class StreamProc {
  private child: ChildProcess;
  private buf = '';
  readonly pid: number | undefined;

  constructor(file: string, args: string[], opts: { cwd: string; env: Record<string, string> }, private on: StreamHandlers) {
    this.child = spawn(file, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.pid = this.child.pid;
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (d: string) => this.feed(d));
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (d: string) => on.stderr(d));
    let ended = false;
    const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (ended) return;
      ended = true;
      on.exit(code, signal);
    };
    this.child.on('exit', (code, signal) => exit(code, signal));
    // a spawn failure (command not found) raises 'error' and no 'exit': count it as an exit, or the session would wait forever
    this.child.on('error', (e) => {
      log.warn('stream: process error', e);
      on.stderr(`${e.message}\n`);
      exit(127, null);
    });
    this.child.stdin?.on('error', (e) => log.warn('stream: stdin error', e));
  }

  private feed(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        this.on.event(JSON.parse(line) as StreamJson);
      } catch {
        this.on.stderr(`${line}\n`);
      }
    }
  }

  private write(j: StreamJson): boolean {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) return false;
    stdin.write(`${JSON.stringify(j)}\n`);
    return true;
  }

  /** A user message: the next turn (queued by the CLI if one is running). */
  sendUser(text: string): boolean {
    return this.write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
  }

  /** Stop the current turn (like Esc in the TUI). */
  interrupt(): boolean {
    return this.write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } });
  }

  /** Close stdin: the CLI finishes the current turn and exits. */
  end(): void {
    this.child.stdin?.end();
  }

  kill(): void {
    try {
      this.child.kill();
    } catch (e) {
      log.warn('stream: kill failed', e);
    }
  }
}

/** The flags that make a Claude launch headless (added after the session's own arguments). */
export const HEADLESS_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];

/** A short line about a tool call for the activity log ("Bash ls -la …", "Edit src/a.ts"). */
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
  const pick = s(i['command'] ?? i['file_path'] ?? i['path'] ?? i['pattern'] ?? i['query'] ?? i['url'] ?? i['description'] ?? i['prompt'] ?? '');
  const one = pick.replace(/\s+/g, ' ').trim();
  return `${name}${one ? ` ${one.length > 160 ? `${one.slice(0, 159)}…` : one}` : ''}`;
}

/** The text blocks of an assistant message, joined. */
export function assistantText(message: unknown): string {
  const m = (message ?? {}) as { content?: unknown };
  if (!Array.isArray(m.content)) return typeof m.content === 'string' ? m.content : '';
  return (m.content as { type?: string; text?: string }[])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('\n');
}

export function toolUses(message: unknown): { name: string; input: unknown }[] {
  const m = (message ?? {}) as { content?: unknown };
  if (!Array.isArray(m.content)) return [];
  return (m.content as { type?: string; name?: string; input?: unknown }[]).filter((c) => c.type === 'tool_use' && typeof c.name === 'string').map((c) => ({ name: c.name!, input: c.input }));
}

/** The result blocks of a "user" event (tool results), as short text. */
export function toolResultText(message: unknown): string {
  const m = (message ?? {}) as { content?: unknown };
  if (!Array.isArray(m.content)) return '';
  const parts: string[] = [];
  for (const c of m.content as { type?: string; content?: unknown; is_error?: boolean }[]) {
    if (c.type !== 'tool_result') continue;
    const inner = Array.isArray(c.content) ? (c.content as { type?: string; text?: string }[]).filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n') : typeof c.content === 'string' ? c.content : '';
    parts.push(`${c.is_error ? '✗ ' : ''}${inner}`);
  }
  return parts.join('\n');
}

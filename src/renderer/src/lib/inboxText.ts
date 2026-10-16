import type { InboxItem } from '@shared/protocol';
import { renderMarkdown } from './markdown';

/**
 * An Inbox notification as the manager reads it: a short label (what happened), its tone, and the body as Markdown.
 * The stored text repeats the session title and has machine wording ("X finished: …", "X — fresh start (auto): …
 * (was 473K tokens) · C:\\…\\note.md", "exited with error (code -1073741510)"); the session title already sits in the
 * row, so it is dropped and the rest is said plainly. Works on old records too (nothing changes in the daemon).
 */
export interface InboxView {
  label: string;
  tone: 'report' | 'question' | 'done' | 'warn' | 'error' | 'info';
  /** Markdown */
  body: string;
  /** one line for the folded row */
  line: string;
}

/** Windows status codes a session's process can end with. */
const EXIT_CODES: Record<string, string> = {
  '0xC000013A': 'stopped by Ctrl+C or its console closing',
  '0xC0000005': 'crashed (access violation)',
  '0xC00000FD': 'crashed (stack overflow)',
  '0xC0000409': 'crashed (stack buffer overrun)',
  '0x40010004': 'its console was closed'
};
const hex = (code: number): string => `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

/** Lines that are Claude Code's terminal screen, not its answer (spinners, tool lines, "Cooked for 1m"). */
const TUI = /^\s*(?:[●⏺✻✶✳✢·⎿│╭╰─]|Running \d+ shell|Cooked for|esc to interrupt|\? for shortcuts)/;

function cleanBody(t: string): string {
  return t
    .replace(/^\(…\d+ chars before\)\s*/, '…')
    .split('\n')
    .filter((l) => !TUI.test(l))
    .join('\n')
    .trim();
}

/** Absolute Windows paths as code spans, so they render as clickable file references. */
const linkPaths = (t: string): string => t.replace(/(^|[\s(])([A-Za-z]:\\[^\s`*()]+)/g, (_m, pre: string, p: string) => `${pre}\`${p}\``);

function firstLine(md: string): string {
  for (const raw of md.split('\n')) {
    const l = raw.replace(/^#+\s*|^[-*]\s+|^>\s*/g, '').replace(/\*\*|__|`/g, '').trim();
    if (l && !/^[|:\-\s]+$/.test(l) && !l.startsWith('```')) return l.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' · ');
  }
  return '';
}

const VERBS: Record<string, [string, InboxView['tone']]> = {
  finished: ['Finished', 'report'],
  replied: ['Replied', 'report'],
  reported: ['Report', 'report'],
  stopped: ['Stopped', 'warn'],
  failed: ['Failed', 'error']
};

/** Inbox records never change: their view (and opened Markdown) is worked out once, again only if the title changes. */
const views = new WeakMap<InboxItem, { title?: string; view: InboxView; html?: string }>();
function cached(it: InboxItem, title?: string): { title?: string; view: InboxView; html?: string } {
  let c = views.get(it);
  if (!c || c.title !== title) {
    c = { title, view: inboxView(it, title) };
    views.set(it, c);
  }
  return c;
}
export const inboxViewOf = (it: InboxItem, title?: string): InboxView => cached(it, title).view;
export function inboxHtml(it: InboxItem, title?: string): string {
  const c = cached(it, title);
  return (c.html ??= renderMarkdown(c.view.body));
}

export function inboxView(it: InboxItem, title?: string): InboxView {
  const text = it.text;
  const view = (label: string, tone: InboxView['tone'], body: string): InboxView => {
    const b = linkPaths(cleanBody(body));
    return { label, tone, body: b, line: firstLine(b) || label };
  };

  // reports: "X finished: …", "X replied: …", "X → Manager (you): …"
  const rep = /^(.*?) (finished|replied|reported|stopped|failed): ([\s\S]*)$/.exec(text);
  if (it.kind === 'report' && rep) {
    const [label, tone] = VERBS[rep[2]!] ?? ['Report', 'report'];
    return view(label, tone, rep[3]!);
  }
  const up = /^(.*?) → Manager \(you\): ([\s\S]*)$/.exec(text);
  if (it.kind === 'report' && up) return view('Report', 'report', up[2]!);

  // notices: "<title> — <what>"
  const dash = title && text.startsWith(`${title} — `) ? text.slice(title.length + 3) : /^.*? — ([\s\S]*)$/.exec(text)?.[1] ?? text;
  let m: RegExpExecArray | null;
  if ((m = /^fresh start( \(auto\))?: new conversation from the handoff note(?: \(was (\S+) tokens\))?(?: · (.+))?$/s.exec(dash))) {
    return view(m[1] ? 'Fresh start (auto)' : 'Fresh start', 'info', `New conversation from its handoff note${m[2] ? ` — the old one had grown to **${m[2]}** tokens` : ''}. The earlier one can be restored from the session.${m[3] ? `\n\nHandoff note: ${m[3]}` : ''}`);
  }
  if ((m = /^fresh start gave up: no handoff note after 15 minutes(?: \((.+)\))?$/s.exec(dash))) {
    return view('Fresh start failed', 'warn', `No handoff note came back within 15 minutes, so it kept its current conversation.${m[1] ? `\n\n${m[1]}` : ''}`);
  }
  if ((m = /^stuck on a prompt while working on (your order|a task from "(.+)"): answer it in its Terminal$/s.exec(dash))) {
    return view('Needs an answer', 'question', `It stopped on a question in its terminal while working on ${m[2] ? `a task from **${m[2]}**` : '**your order**'}. Open it and answer in the **Terminal** view.`);
  }
  if ((m = /^answer its prompt so it can receive (\d+) team message\(s\)$/.exec(dash))) {
    return view('Needs an answer', 'question', `It is stopped on a prompt, so **${m[1]}** team message(s) are waiting to be delivered. Answer it in the **Terminal** view.`);
  }
  if (dash === 'waiting for input') return view('Waiting for input', 'question', 'It finished its turn and is waiting for your input.');
  if (dash === 'finished') return view('Ended', 'done', 'The session ended normally.');
  if ((m = /^exited with error \(code (-?\d+)\)$/.exec(dash))) {
    const h = hex(Number(m[1]));
    return view('Exited with an error', 'error', `The session's process ended unexpectedly — ${EXIT_CODES[h] ?? 'see its Terminal for the last output'} (code ${h}). Resume it to continue its conversation.`);
  }
  const tone: InboxView['tone'] = it.kind === 'error' ? 'error' : it.kind === 'waiting' ? 'question' : it.kind === 'done' ? 'done' : 'info';
  const label = it.kind === 'error' ? 'Error' : it.kind === 'waiting' ? 'Waiting' : it.kind === 'done' ? 'Done' : 'Notice';
  return view(label, tone, dash);
}

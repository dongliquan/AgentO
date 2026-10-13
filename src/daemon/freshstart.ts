import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '@shared/protocol';
import { findTranscript, readTranscriptLines } from './transcript';
import { dataDir, ensureDir } from './paths';

/**
 * Fresh start: a long Claude conversation is re-read on every turn (most of the token use). The session writes a
 * handoff note, AgentO starts it over as a new conversation, and the note is its first message — the context carries
 * on in a few KB instead of hundreds of K tokens. Manual (session menu) or automatic (idle sessions over a size).
 */

/** Handoff notes: one Markdown file per fresh start (Claude sessions get this folder with --add-dir). */
export function handoffDir(): string {
  return ensureDir(path.join(dataDir(), 'handoff'));
}

/**
 * Automatic fresh start, by size: an idle Claude conversation that carries at least AUTO_MIN_CONTEXT tokens. On unless
 * AGENTO_AUTO_FRESH=0; the size with AGENTO_AUTO_FRESH_MIN (tokens).
 */
export const AUTO_FRESH = process.env['AGENTO_AUTO_FRESH'] !== '0';
export const AUTO_MIN_CONTEXT = Math.max(20_000, Number(process.env['AGENTO_AUTO_FRESH_MIN'] || 200_000) || 200_000);
/** head coaches / coaches sooner: every report that reaches them re-reads their whole conversation */
export const AUTO_MIN_CONTEXT_COORD = Math.max(20_000, Number(process.env['AGENTO_AUTO_FRESH_MIN_COORD'] || 100_000) || 100_000);
/** a conversation younger than this is left alone (no loop of restarts), and it must have been idle this long */
export const AUTO_MIN_GAP_MS = 3 * 3600_000;
/** idle this long, and not open on screen: shortly before it would be auto-hibernated (30 min) anyway */
export const AUTO_IDLE_MS = 25 * 60_000;

/** last answer per transcript, by file size: a turn that wrote nothing new is not read again */
const sizes = new Map<string, { size: number; value: number | undefined }>();

/** Tokens the last call of a Claude conversation carried (input + cache): what the next turn re-reads. */
export function contextSize(cwd: string, resumeId: string | undefined): number | undefined {
  if (!resumeId) return undefined;
  const file = findTranscript(cwd, resumeId);
  if (!file) return undefined;
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return undefined;
  }
  const cached = sizes.get(file);
  if (cached && cached.size === size) return cached.value;
  // the last call is near the end; a huge last line (a long answer) may need a bigger tail
  const value = readContext(file, 128 * 1024) ?? readContext(file, 1024 * 1024);
  sizes.set(file, { size, value });
  return value;
}

function readContext(file: string, tail: number): number | undefined {
  let lines: string[];
  try {
    lines = readTranscriptLines(file, tail);
  } catch {
    return undefined;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.includes('"usage"')) continue;
    try {
      const j = JSON.parse(l) as { message?: { usage?: Record<string, number> } };
      const u = j.message?.usage;
      if (!u) continue;
      return (u['input_tokens'] ?? 0) + (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0);
    } catch {
      /* a partial line at the start of the tail */
    }
  }
  return undefined;
}

/** When the current conversation began (its transcript file's birth): the last fresh start, or the session's start. */
export function conversationStart(cwd: string, resumeId: string | undefined): number | undefined {
  if (!resumeId) return undefined;
  const file = findTranscript(cwd, resumeId);
  if (!file) return undefined;
  try {
    const st = fs.statSync(file);
    return st.birthtimeMs || st.ctimeMs;
  } catch {
    return undefined;
  }
}

export function handoffPath(s: Pick<Session, 'id' | 'title'>): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const name = s.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'session';
  return path.join(handoffDir(), `${name}-${s.id.slice(0, 8)}-${stamp}.md`);
}

export const HANDOFF_REQUEST =
  `[AgentO] Fresh start: this conversation is getting long, so AgentO will clear it and start you over with a short ` +
  `handoff note instead (it saves tokens on every turn). Reply now with that note as your whole answer — AgentO saves ` +
  `it to a file and gives it to the new conversation. Do not use any tools and do not continue the work.\n\n` +
  `Markdown, in the language of this conversation, complete enough to carry on without the old conversation:\n` +
  `- goal and scope of the work\n- current state: what is done, what is in progress\n- decisions made and why\n` +
  `- files changed or created (full paths), branches / worktrees\n- how to check it (commands, URLs, test data)\n` +
  `- open questions, things waiting on someone, and the next steps`;

export const HANDOFF_CONTINUE = (file: string): string =>
  `[AgentO] Fresh start — this is a new conversation that continues your earlier work. Read the handoff note first:\n` +
  `${file}\nThen carry on from its next steps. If something you need is missing from it, say so.`;

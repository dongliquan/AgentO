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
// players 150K (was 200K, 2026-10-27): the project memory now carries the rules, map and decisions, so a shorter
// conversation loses little — and every turn re-reads all of it
export const AUTO_MIN_CONTEXT = Math.max(20_000, Number(process.env['AGENTO_AUTO_FRESH_MIN'] || 150_000) || 150_000);
/** head coaches / coaches sooner: every report that reaches them re-reads their whole conversation */
export const AUTO_MIN_CONTEXT_COORD = Math.max(20_000, Number(process.env['AGENTO_AUTO_FRESH_MIN_COORD'] || 100_000) || 100_000);
/** a conversation younger than this is left alone (no loop of restarts), and it must have been idle this long */
export const AUTO_MIN_GAP_MS = 3 * 3600_000;
/** idle this long, and not open on screen: shortly before it would be auto-hibernated (30 min) anyway */
export const AUTO_IDLE_MS = 25 * 60_000;
/**
 * A conversation twice the threshold (players 300K, coordinators 200K by default) costs that much on every turn: it is
 * cleared after a short pause even when the manager is using the session (the earlier one can be restored).
 */
export const AUTO_OVERSIZE_FACTOR = 2;
export const AUTO_OVERSIZE_IDLE_MS = 15 * 60_000;
/** never cleared by itself while the manager is working in it: typed into in the last hour (the Large chat alert asks) */
export const AUTO_MANAGER_QUIET_MS = 60 * 60_000;

/** last answer per transcript, by file size: a turn that wrote nothing new is not read again */
const sizes = new Map<string, { size: number; value: { context: number; model?: string } | undefined }>();

/** The conversation's size and the model of its last call, from the end of the transcript (cached by file size). */
export function transcriptInfo(cwd: string, resumeId: string | undefined): { context?: number; model?: string } | undefined {
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

function readContext(file: string, tail: number): { context: number; model?: string } | undefined {
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
      const j = JSON.parse(l) as { message?: { usage?: Record<string, number>; model?: string } };
      const u = j.message?.usage;
      if (!u) continue;
      const model = j.message?.model;
      return {
        context: (u['input_tokens'] ?? 0) + (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0),
        ...(model && model !== '<synthetic>' ? { model } : {})
      };
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
  `it to a file and gives it to the new conversation. Do not continue the work; the only tool to use now is ` +
  `update_memory — first put the decisions, conventions and traps the whole project should keep into the project memory.\n\n` +
  `Markdown, in the language of this conversation, complete enough to carry on without the old conversation:\n` +
  `- goal and scope of the work\n- current state: what is done, what is in progress\n- decisions made and why\n` +
  `- files changed or created (full paths), branches / worktrees\n- how to check it (commands, URLs, test data)\n` +
  `- open questions, things waiting on someone, and the next steps`;

export const HANDOFF_CONTINUE = (file: string): string =>
  `[AgentO] Fresh start — this is a new conversation that continues your earlier work. Read the handoff note first:\n` +
  `${file}\nIts end has the last request and your last answer word for word: carry on from there (and from its next ` +
  `steps). If something you need is missing from it, say so.`;

/** The start of the handoff request, to find where the old conversation ended. */
export const HANDOFF_MARK = '[AgentO] Fresh start: this conversation is getting long';

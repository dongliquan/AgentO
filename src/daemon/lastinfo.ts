import fs from 'node:fs';
import type { ChatEntry, SessionLast } from '@shared/protocol';
import type { StoredSession } from './store';
import { TranscriptParser, findTranscript, readTranscriptLines } from './transcript';
import { findCodexRollout, readCodex } from './codex';
import { findGeminiChat, readGemini } from './gemini';

/**
 * Where a session left off: the last thing it was asked and the end of its last answer, read from the conversation
 * file the CLI keeps (a stopped session has no screen, but its conversation is still there). Cached by file size and
 * time, so asking again for a session that did not change costs a stat.
 */
const TAIL_BYTES = 512 * 1024;
const cache = new Map<string, { sig: string; last: SessionLast | null }>();

/** "[Order from … — #T12]" / "[Message from …]" / "[AgentO] …" headers and pasted-content tags are not what was asked. */
function asked(text: string): string {
  const body = text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/^\s*\[(?:Order|Message) from [^\]\n]{0,200}\]\s*/i, '')
    .replace(/^\s*\[AgentO\]\s*/i, '');
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > 180 ? `${first.slice(0, 179)}…` : first;
}

/** The end of an answer: its last paragraph (the result), not the narration at the start. */
function ended(text: string): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\*\*|`/g, '').trim()).filter(Boolean);
  const last = paras[paras.length - 1] ?? '';
  const oneLine = last.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean).slice(0, 2).join(' ');
  return oneLine.length > 260 ? `${oneLine.slice(0, 259)}…` : oneLine;
}

function entriesOf(s: StoredSession): { file: string; entries: ChatEntry[] } | undefined {
  if (s.agent === 'codex' && s.resumeId) {
    const file = findCodexRollout(s.resumeId);
    return file ? { file, entries: readCodex(file).entries } : undefined;
  }
  if (s.agent === 'gemini' && s.resumeId) {
    const file = findGeminiChat(s.cwd, s.resumeId);
    return file ? { file, entries: readGemini(file).entries } : undefined;
  }
  if (s.agent !== 'claude' || !s.resumeId) return undefined;
  const file = findTranscript(s.cwd, s.resumeId);
  if (!file) return undefined;
  const parser = new TranscriptParser();
  for (const line of readTranscriptLines(file, TAIL_BYTES)) {
    try {
      parser.feed(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* partial line */
    }
  }
  return { file, entries: parser.entries };
}

export function lastInfo(s: StoredSession): SessionLast | undefined {
  if (!s.resumeId) return undefined;
  let sig = '';
  try {
    const file = s.agent === 'codex' ? findCodexRollout(s.resumeId) : s.agent === 'gemini' ? findGeminiChat(s.cwd, s.resumeId) : findTranscript(s.cwd, s.resumeId);
    if (!file) return undefined;
    const st = fs.statSync(file);
    sig = `${file}|${st.size}|${st.mtimeMs}`;
  } catch {
    return undefined;
  }
  const hit = cache.get(s.id);
  if (hit && hit.sig === sig) return hit.last ?? undefined;
  const got = entriesOf(s);
  let last: SessionLast | null = null;
  if (got) {
    const e = got.entries;
    // the newest user turn that says something (a turn that is only a pasted image or a tag is skipped)
    let u = -1;
    for (let i = e.length - 1; i >= 0; i--) if (e[i]!.kind === 'user' && asked(e[i]!.text ?? '')) { u = i; break; }
    let a = -1;
    for (let i = e.length - 1; i >= 0; i--) if (e[i]!.kind === 'assistant' && (e[i]!.text ?? '').trim()) { a = i; break; }
    if (u >= 0 || a >= 0) {
      last = {
        ask: u >= 0 ? asked(e[u]!.text ?? '') : '',
        reply: a >= 0 ? ended(e[a]!.text ?? '') : '',
        at: e[e.length - 1]!.ts || fs.statSync(got.file).mtimeMs
      };
    }
  }
  cache.set(s.id, { sig, last });
  return last ?? undefined;
}

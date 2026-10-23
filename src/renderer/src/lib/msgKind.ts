import type { InboxItem } from '@shared/protocol';
import type { TeamMessage } from './teamMessage';
import { isAck, isDirect, pieceResult } from './threads';
import { askingTail } from './needsYou';
import { bodyOf } from './timeline';

/**
 * What a team message is, as one word in front of it (the Flow, Logs, chat bubbles, the Me tab): the daemon's facts
 * (a directive or a report, from whom) plus one reading of the text — a question is an `ask` whichever way it goes.
 *  order      the manager's order (Manager tab, a routine)
 *  direct     the manager typed into the session
 *  task       a session handed work to another (send_to_session as a directive)
 *  ask        a question or a request for a decision
 *  report     a result (report_up, a coordinator's answer to the manager)
 *  finished   the daemon's notice that a session finished the task it was sent
 *  handed on  a coordinator's turn that ended right after handing the work on (no result yet)
 *  note       any other message between sessions
 */
export type MsgKind = 'order' | 'direct' | 'task' | 'ask' | 'report' | 'finished' | 'handed on' | 'note';

/** CSS class suffix (`.msg-tag.k-<slug>`, `.flow-step.k-<slug>`) */
export const kindSlug = (k: MsgKind): string => k.replace(' ', '-');

const REPORT_PREFIX = /^\(report\)\s*/;
const isQuestion = (body: string): boolean => askingTail(body.replace(REPORT_PREFIX, '')) !== null;

const cache = new WeakMap<InboxItem, MsgKind>();

/** The kind of an inbox record (directive / report with a sender). */
export function msgKind(it: InboxItem): MsgKind {
  let k = cache.get(it);
  if (k) return k;
  k = compute(it);
  cache.set(it, k);
  return k;
}

function compute(it: InboxItem): MsgKind {
  if (isAck(it)) return 'handed on';
  if (it.kind === 'directive') {
    if (it.fromId === 'user') return isDirect(it) ? 'direct' : 'order';
    return 'task';
  }
  // the daemon's completion notice: between sessions ("A → B: finished: …") or to the manager ("A finished: …")
  if (pieceResult(it) === 'finished' || pieceResult(it) === 'stopped') return 'finished';
  if (it.fromId === it.sessionId && /^[^\n]*? (?:finished|stopped(?: \([^)]*\))?): /.test(it.text)) return 'finished';
  const body = bodyOf(it);
  if (isQuestion(body)) return 'ask';
  // a report_up, a coordinator's answer to the manager, or a plain message between sessions
  if (REPORT_PREFIX.test(body) || it.fromId === it.sessionId || pieceResult(it) === 'replied') return 'report';
  return 'note';
}

/** The kind of a message as it appears in a session's conversation (the receiving side). */
export function teamMessageKind(msg: TeamMessage): MsgKind {
  if (msg.kind === 'order') return 'order';
  if (msg.kind === 'notice') {
    if (/\b(finished|stopped)\b/.test(msg.body.slice(0, 200))) return 'finished';
    return 'note';
  }
  if (isQuestion(msg.body)) return 'ask';
  if (REPORT_PREFIX.test(msg.body)) return 'report';
  // a message from a coordinator is work handed down; between peers it is a note
  return /head|coach/i.test(msg.role ?? '') ? 'task' : 'note';
}

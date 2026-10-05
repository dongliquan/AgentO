import type { InboxItem, Session } from '@shared/protocol';
import { type LogNode } from './threads';

export type WorkState = 'done' | 'working' | 'waiting' | 'stopped' | 'error' | 'removed';

/** One piece of work under an order: a directive that was not split further (a leaf), and who holds it. */
export interface WorkItem {
  node: LogNode;
  session?: Session;
  state: WorkState;
  /** the last record in this branch (a report back, a question …) */
  lastAt: number;
}

export interface OrderProgress {
  items: WorkItem[];
  done: number;
  total: number;
  working: number;
  /** sessions still holding unfinished work (to show what they are doing now) */
  active: Session[];
  lastAt: number;
}

function reported(n: LogNode): boolean {
  // the taker answered back up the chain: a report from the session that received this directive
  return n.children.some((c) => c.item.kind === 'report' && c.item.fromId === n.item.sessionId);
}

function last(n: LogNode): number {
  return Math.max(n.item.createdAt, ...n.children.map(last));
}

function stateOf(n: LogNode, sessions: Map<string, Session>): WorkState {
  if (reported(n)) return 'done';
  const s = sessions.get(n.item.sessionId);
  if (!s) return 'removed';
  if (s.status === 'working' || s.status === 'starting') return 'working';
  if (s.status === 'waiting') return 'waiting';
  if (s.status === 'error') return 'error';
  return 'stopped';
}

/** The directives under a node that were not handed on further — the actual pieces of work. */
function leaves(n: LogNode): LogNode[] {
  const subs = n.children.filter((c) => c.item.kind === 'directive');
  if (subs.length === 0) return [n];
  return subs.flatMap(leaves);
}

/**
 * Where an order stands, read from the team traffic alone: every directive handed down that was not split further is
 * one piece of work; it is done when its taker reported back. An order nobody split is one piece of work itself.
 */
export function orderProgress(root: LogNode, sessions: Map<string, Session>): OrderProgress {
  const items: WorkItem[] = leaves(root).map((n) => ({ node: n, session: sessions.get(n.item.sessionId), state: stateOf(n, sessions), lastAt: last(n) }));
  const done = items.filter((i) => i.state === 'done').length;
  const working = items.filter((i) => i.state === 'working').length;
  const active = [...new Map(items.filter((i) => i.state !== 'done' && i.session).map((i) => [i.session!.id, i.session!])).values()];
  return { items, done, total: items.length, working, active, lastAt: last(root) };
}

/** The first line of an order/report text without the "<from> → <to>: " prefix. */
export function firstLine(it: InboxItem): string {
  const head = it.text.indexOf(': ');
  const body = head >= 0 ? it.text.slice(head + 2) : it.text;
  return body.replace(/^\[Order from [^\]]*\]\s*/, '').split('\n').find((l) => l.trim()) ?? '';
}

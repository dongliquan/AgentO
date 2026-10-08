import type { InboxItem, Session } from '@shared/protocol';

export interface LogNode {
  item: InboxItem;
  children: LogNode[];
}

/**
 * Team traffic as threads: each order from the manager (or a routine run) is a root; what a session sends while it
 * works on a directive hangs under that directive — manager → head coach → coaches → players, with the reports,
 * questions and answers in between. Built from the inbox records (directive/report with fromId), oldest first.
 */
export function buildThreads(inbox: InboxItem[]): LogNode[] {
  const records = inbox.filter((i) => (i.kind === 'directive' || i.kind === 'report') && i.fromId).sort((a, b) => a.createdAt - b.createdAt);
  /** the latest directive each session received — what it is working on */
  const current = new Map<string, LogNode>();
  const roots: LogNode[] = [];
  for (const item of records) {
    const node: LogNode = { item, children: [] };
    const parent = item.fromId && item.fromId !== 'user' ? current.get(item.fromId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (item.kind === 'directive') current.set(item.sessionId, node);
  }
  return roots;
}

export function count(n: LogNode): number {
  return n.children.reduce((sum, c) => sum + 1 + count(c), 0);
}

/**
 * The daemon's report that a session finished (or stopped on) a directive from another session — "A → B: finished: …".
 * Work news for the manager's Inbox, though it went to the sender.
 */
export function pieceResult(it: InboxItem): 'finished' | 'replied' | 'stopped' | null {
  if (it.kind !== 'report' || !it.fromId || it.fromId === it.sessionId) return null;
  const m = /^[^\n]*? \u2192 [^\n]*?: (finished|replied|stopped)\b/.exec(it.text);
  return (m?.[1] as 'finished' | 'replied' | 'stopped' | undefined) ?? null;
}

/** What the manager typed into a session directly (daemon Team.note), not an order from the Manager tab. */
export function isDirect(it: InboxItem): boolean {
  return it.fromId === 'user' && it.text.startsWith('Manager (you) · Direct →');
}

/** A record the manager is part of: an order from the user, or a report addressed to the user (filed under its sender). */
export function withManager(it: InboxItem): boolean {
  return it.fromId === 'user' || it.fromId === it.sessionId;
}

/** Every record under a node, depth first. */
export function descendants(n: LogNode): InboxItem[] {
  return n.children.flatMap((c) => [c.item, ...descendants(c)]);
}

/** A copy of the thread keeping only branches that contain a match (the matching records and their ancestors). */
export function prune(n: LogNode, hit: (it: InboxItem) => boolean): LogNode | null {
  const children = n.children.map((c) => prune(c, hit)).filter((c): c is LogNode => c !== null);
  return hit(n.item) || children.length > 0 ? { item: n.item, children } : null;
}

/**
 * One of the manager's orders that is a task, not just a conversation: it was added as a task, it went straight to a
 * coach or a player (they do the work), or the one who took it handed work on (a directive to a coach or a player).
 */
export function isTask(node: LogNode, sessions: Map<string, Session>, explicit: ReadonlySet<string>): boolean {
  if (node.item.fromId !== 'user' || isDirect(node.item)) return false;
  if (explicit.has(node.item.id)) return true;
  // a status check or a follow-up from the task list belongs to the task it is about, not a task of its own
  if (/Status check on this order|\(Follow-up on: /.test(node.item.text)) return false;
  const to = sessions.get(node.item.sessionId);
  if (to && to.role !== 'head') return true;
  return node.children.some((c) => c.item.kind === 'directive');
}

export type OrderStatus = 'reported' | 'working' | 'waiting' | 'stopped' | 'error' | 'removed';

/**
 * Where one of the manager's orders stands: reported once a report came back to the manager, otherwise what the
 * session that took it is doing now.
 */
export function orderStatus(node: LogNode, sessions: Map<string, Session>): OrderStatus {
  if (descendants(node).some((it) => it.kind === 'report' && withManager(it))) return 'reported';
  const s = sessions.get(node.item.sessionId);
  if (!s) return 'removed';
  if (s.status === 'working' || s.status === 'starting') return 'working';
  if (s.status === 'waiting') return 'waiting';
  if (s.status === 'error') return 'error';
  return 'stopped';
}

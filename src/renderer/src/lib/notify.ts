import { create } from 'zustand';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { buildThreads, isAck, isDirect, pieceResult } from '@/lib/threads';
import { firstLine, orderProgress } from '@/lib/progress';
import { runCommand, selectAndReveal } from '@/commands';

/**
 * What raises a notification: a report addressed to the manager, an order of the manager's whose pieces are all
 * reported back, and session status changes (every session, only head coaches and coaches, or none). Per viewer,
 * in localStorage. The window in the background gets an OS notification; a focused window shows a toast instead.
 */
export interface NotifyPrefs {
  reports: boolean;
  orders: boolean;
  /** a session finished or stopped on a piece of work it got from the team */
  pieces: boolean;
  sessions: 'all' | 'leads' | 'off';
}

const KEY = 'asm.notify';
const DEFAULTS: NotifyPrefs = { reports: true, orders: true, pieces: true, sessions: 'all' };

function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) };
  } catch {
    /* defaults */
  }
  return DEFAULTS;
}

export const useNotifyPrefs = create<NotifyPrefs & { set: (p: Partial<NotifyPrefs>) => void }>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    const { reports, orders, pieces, sessions } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ reports, orders, pieces, sessions }));
    } catch {
      /* not kept */
    }
  }
}));

export interface Toast {
  id: number;
  title: string;
  body: string;
  /** a palette/menu command id run on click */
  command?: string;
  sessionId?: string;
}

let toastSeq = 0;
export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismiss(id), 8000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}));

/** Opens what a notification is about: the session on the Ground, and the command's view (the Manager tab). */
export function openNotification(t: { command?: string; sessionId?: string }): void {
  if (t.sessionId && useStore.getState().sessions.has(t.sessionId)) selectAndReveal(t.sessionId);
  if (t.command) runCommand(t.command);
}

function windowIsBackground(): boolean {
  return document.hidden || !document.hasFocus();
}

/** when each session last raised a report / order notification — its status notification right after is the same news */
const recent = new Map<string, number>();

function raise(title: string, body: string, sessionId?: string, command?: string): void {
  if (sessionId) recent.set(sessionId, Date.now());
  // the user is looking at that very session: they see the answer arrive
  if (!windowIsBackground() && sessionId && useStore.getState().selectedId === sessionId) return;
  if (windowIsBackground()) {
    try {
      window.desktop.notify(title, body, sessionId, command);
    } catch (e) {
      console.warn('[notify]', e);
    }
  } else useToasts.getState().push({ title, body, sessionId, command });
}

/** Whether a session's status change should raise an OS notification under the current settings. */
export function wantsStatusNotification(s: Session): boolean {
  const pref = useNotifyPrefs.getState().sessions;
  if (pref === 'off') return false;
  if (pref === 'leads' && s.role !== 'head' && s.role !== 'coach') return false;
  return Date.now() - (recent.get(s.id) ?? 0) > 15_000;
}

const isReportToManager = (i: InboxItem): boolean => i.kind === 'report' && !!i.fromId && i.fromId === i.sessionId && !isAck(i);

/** Main window only: watches the inbox for reports to the manager and finished orders. */
export function initNotifications(): void {
  const seenReports = new Set<string>();
  const seenPieces = new Set<string>();
  /** every inbox id seen so far (to tell a new report from an old one) */
  const seenAll = new Set<string>();
  const doneOrders = new Set<string>();
  let seeded = false;

  const doneRoots = (inbox: InboxItem[], sessions: Map<string, Session>) =>
    buildThreads(inbox).filter((n) => {
      if (n.item.fromId !== 'user' || isDirect(n.item)) return false;
      const p = orderProgress(n, sessions);
      return p.total > 0 && p.done === p.total;
    });

  useStore.subscribe((next, prev) => {
    // a request the daemon refused (e.g. "busy — fresh start it when it is idle"): say so
    if (next.lastError && next.lastError !== prev.lastError) {
      useToasts.getState().push({ title: 'Could not do that', body: next.lastError });
      // cleared, so the same refusal shows again next time
      setTimeout(() => useStore.setState({ lastError: null }), 0);
    }
    if (next.inbox === prev.inbox) return;
    // the first inbox from the daemon is history: remember it, raise nothing
    if (!seeded) {
      seeded = true;
      for (const i of next.inbox) if (isReportToManager(i)) seenReports.add(i.id);
      for (const i of next.inbox) if (pieceResult(i)) seenPieces.add(i.id);
      for (const n of doneRoots(next.inbox, next.sessions)) doneOrders.add(n.item.id);
      for (const i of next.inbox) seenAll.add(i.id);
      return;
    }
    const prefs = useNotifyPrefs.getState();
    // a piece of work came back to whoever sent it (a stop is the one that needs a next step)
    for (const i of next.inbox) {
      const r = pieceResult(i);
      if (!r || seenPieces.has(i.id)) continue;
      seenPieces.add(i.id);
      if (!prefs.pieces) continue;
      const from = i.fromId ? next.sessions.get(i.fromId) : undefined;
      const to = next.sessions.get(i.sessionId);
      const body = i.text.slice(i.text.indexOf(': ') + 2).replace(/^(finished|replied|stopped \([^)]*\)):\s*/, '');
      raise(`${r === 'stopped' ? 'Stopped' : 'Piece done'} · ${from?.title ?? 'session'}${to ? ` \u2192 ${to.title}` : ''}`, body.split('\n').find((l) => l.trim()) ?? '', from?.id, 'view.inbox');
    }
    const fresh = next.inbox.filter((i) => isReportToManager(i) && !seenReports.has(i.id));
    for (const i of fresh) seenReports.add(i.id);
    const covered = new Set<string>();
    // an order only completes when a report arrives: no new report, no need to rebuild every thread's progress
    const newReport = next.inbox.some((i) => i.kind === 'report' && !seenAll.has(i.id));
    for (const i of next.inbox) seenAll.add(i.id);

    for (const n of newReport ? doneRoots(next.inbox, next.sessions) : []) {
      if (doneOrders.has(n.item.id)) continue;
      doneOrders.add(n.item.id);
      // the report that finished it, if it is one of the new ones, is told with the order
      const ids = new Set<string>();
      const walk = (x: typeof n): void => {
        ids.add(x.item.id);
        x.children.forEach(walk);
      };
      walk(n);
      const report = fresh.filter((i) => ids.has(i.id)).pop();
      if (report) covered.add(report.id);
      if (!prefs.orders) continue;
      const to = next.sessions.get(n.item.sessionId);
      raise(`Order done${to ? ` · ${to.title}` : ''}`, report ? firstLine(report) : firstLine(n.item), report?.sessionId ?? n.item.sessionId, 'view.orders');
    }

    if (!prefs.reports) return;
    for (const i of fresh) {
      if (covered.has(i.id)) continue;
      const from = next.sessions.get(i.sessionId);
      raise(`Report · ${from?.title ?? 'session'}`, firstLine(i), i.sessionId, 'view.orders');
    }
  });
}

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useOpenInbox } from '@/lib/closed';

/** a hand-off older than this is not shown as in progress any more (the work was forgotten or done some other way) */
const STALE_MS = 24 * 3600_000;

/**
 * Work a coordinator (Coach / Head Coach) handed to a session and has not heard back on: its last directive to that
 * session with no report from it since. A coordinator that is "idle" while its players work shows this instead.
 */
export function openDelegations(inbox: InboxItem[], sessions: Map<string, Session>, now = Date.now()): Map<string, { target: string; at: number }[]> {
  const lastDirective = new Map<string, number>(); // "from|to" → when
  const lastReport = new Map<string, number>(); // "to|from" (the target reporting back to its coordinator) → when
  for (const it of inbox) {
    if (!it.fromId || it.fromId === 'user' || it.fromId === it.sessionId) continue;
    const key = `${it.fromId}|${it.sessionId}`;
    if (it.kind === 'directive') lastDirective.set(key, Math.max(lastDirective.get(key) ?? 0, it.createdAt));
    else if (it.kind === 'report') lastReport.set(key, Math.max(lastReport.get(key) ?? 0, it.createdAt));
  }
  const out = new Map<string, { target: string; at: number }[]>();
  for (const [key, at] of lastDirective) {
    const [from, to] = key.split('|') as [string, string];
    const coach = sessions.get(from);
    if (!coach || coach.role === 'player' || !sessions.has(to) || now - at > STALE_MS) continue;
    if ((lastReport.get(`${to}|${from}`) ?? 0) > at) continue;
    out.set(from, [...(out.get(from) ?? []), { target: to, at }]);
  }
  return out;
}

/** The open hand-offs, worked out once per window by <DelegationWatcher /> (tree rows, cards and links read them). */
export const useDelegations = create<{ byCoach: Map<string, { target: string; at: number }[]>; sig: string }>(() => ({ byCoach: new Map(), sig: '' }));

export function DelegationWatcher(): null {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const byCoach = useMemo(() => openDelegations(inbox, sessions), [inbox, sessions]);
  useEffect(() => {
    const sig = [...byCoach].map(([k, v]) => `${k}:${v.map((x) => x.target).join(',')}`).join('|');
    if (sig !== useDelegations.getState().sig) useDelegations.setState({ byCoach, sig });
  }, [byCoach]);
  return null;
}

/** "→ 2 working" beside a coordinator: the work it handed on that is still going (or waiting to be picked up). */
export function DelegationChip({ id }: { id: string }): JSX.Element | null {
  const list = useDelegations((s) => s.byCoach.get(id));
  const working = useStore((s) => (list ? list.filter((d) => { const t = s.sessions.get(d.target); return t?.status === 'working' || t?.status === 'starting'; }).length : 0));
  const names = useStore((s) => (list ? list.map((d) => s.sessions.get(d.target)?.title ?? '?').join(', ') : ''));
  if (!list?.length) return null;
  return (
    <span className={`deleg-chip ${working ? 'working' : ''}`} title={`Handed on, no report back yet: ${names}`}>
      → {working ? `${working} working` : `${list.length} waiting`}
    </span>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useOpenInbox } from '@/lib/closed';
import { relativeTime, statusClass, statusLabel } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { selectAndReveal } from '@/commands';
import { Activity } from './OrderProgress';
import { titleOf } from '@/lib/timeline';

/** a hand-off older than this is not shown as in progress any more (the work was forgotten or done some other way) */
const STALE_MS = 24 * 3600_000;

/** hand-offs the Manager cleared by hand (✕ on the card) */
const DISMISS_KEY = 'asm.delegDismissed';
const delegKey = (d: { target: string; at: number; task?: string }): string => `${d.task ?? ''}|${d.target}|${d.at}`;
function dismissed(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function dismiss(d: { target: string; at: number; task?: string }): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed(), delegKey(d)].slice(-300)));
  } catch {
    /* not kept */
  }
}

/**
 * Work a coordinator (Coach / Head Coach) handed to a session and has not heard back on: its last directive to that
 * session with no report from it since. A coordinator that is "idle" while its players work shows this instead.
 */
export function openDelegations(inbox: InboxItem[], sessions: Map<string, Session>, now = Date.now()): Map<string, { target: string; at: number; task?: string }[]> {
  // with task ids (#T12): one piece of work per task, open until that session reports on that task
  const doneTasks = new Set<string>(); // "task|from" (the target's report to its coordinator about that task)
  const lastReport = new Map<string, number>(); // "to|from" → when (records without a task id)
  const reportedAt = new Map<string, number>(); // session → its latest report to anyone (coordinator or Manager)
  for (const it of inbox) {
    if (it.kind === 'report' && it.fromId) reportedAt.set(it.fromId, Math.max(reportedAt.get(it.fromId) ?? 0, it.createdAt));
    if (it.kind !== 'report' || !it.fromId || it.fromId === it.sessionId) continue;
    if (it.taskId) doneTasks.add(`${it.taskId}|${it.fromId}`);
    lastReport.set(`${it.fromId}|${it.sessionId}`, Math.max(lastReport.get(`${it.fromId}|${it.sessionId}`) ?? 0, it.createdAt));
  }
  const byTask = new Map<string, { from: string; target: string; at: number; task?: string }>();
  for (const it of inbox) {
    if (it.kind !== 'directive' || !it.fromId || it.fromId === 'user' || it.fromId === it.sessionId) continue;
    const key = it.taskId ? `${it.taskId}|${it.fromId}|${it.sessionId}` : `-|${it.fromId}|${it.sessionId}`;
    const prev = byTask.get(key);
    if (!prev || prev.at < it.createdAt) byTask.set(key, { from: it.fromId, target: it.sessionId, at: it.createdAt, ...(it.taskId ? { task: it.taskId } : {}) });
  }
  const out = new Map<string, { target: string; at: number; task?: string }[]>();
  for (const d of byTask.values()) {
    const coach = sessions.get(d.from);
    if (!coach || coach.role === 'player' || !sessions.has(d.target) || now - d.at > STALE_MS) continue;
    if (d.task ? doneTasks.has(`${d.task}|${d.target}`) : (lastReport.get(`${d.target}|${d.from}`) ?? 0) > d.at) continue;
    // reported since (numbered differently, or straight to the Manager) and resting now: done, whatever the number says
    const t = sessions.get(d.target);
    if (t && t.status !== 'working' && t.status !== 'starting' && (reportedAt.get(d.target) ?? 0) > d.at) continue;
    if (dismissed().has(delegKey(d))) continue;
    out.set(d.from, [...(out.get(d.from) ?? []), { target: d.target, at: d.at, ...(d.task ? { task: d.task } : {}) }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at);
  return out;
}

/** The open hand-offs, worked out once per window by <DelegationWatcher /> (tree rows, cards and links read them). */
export const useDelegations = create<{ byCoach: Map<string, { target: string; at: number; task?: string }[]>; sig: string }>(() => ({ byCoach: new Map(), sig: '' }));

export function DelegationWatcher(): null {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const [cleared, setCleared] = useState(0);
  useEffect(() => {
    const on = (): void => setCleared((n) => n + 1);
    window.addEventListener('asm-deleg-dismissed', on);
    return () => window.removeEventListener('asm-deleg-dismissed', on);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const byCoach = useMemo(() => openDelegations(inbox, sessions), [inbox, sessions, cleared]);
  useEffect(() => {
    const sig = [...byCoach].map(([k, v]) => `${k}:${v.map((x) => `${x.task ?? ''}${x.target}`).join(',')}`).join('|');
    if (sig !== useDelegations.getState().sig) useDelegations.setState({ byCoach, sig });
  }, [byCoach]);
  return null;
}

/**
 * At the end of a coordinator's conversation: each piece of work it handed out and has not heard back on — who has
 * it, its task id, how long, what that session is doing now. Click opens that session. Nothing to send: the result
 * comes back to the coordinator by itself when the session finishes.
 */
export function DelegationStrip({ id }: { id: string }): JSX.Element | null {
  const list = useDelegations((s) => s.byCoach.get(id));
  const sessions = useStore((s) => s.sessions);
  const inbox = useOpenInbox();
  const now = useNow(30_000);
  const [folded, setFolded] = useState(() => readFolded());
  if (!list?.length) return null;
  const fold = (v: boolean): void => {
    setFolded(v);
    try {
      localStorage.setItem(FOLD_KEY, v ? '1' : '');
    } catch {
      /* not kept */
    }
  };
  if (folded)
    return (
      <button className="deleg-strip folded" onClick={() => fold(false)} title="Show the work handed out">
        Handed out {list.length} ▾
      </button>
    );
  return (
    <div className="deleg-strip">
      <div className="deleg-strip-head" title="The results come back to this chat by themselves">
        <span>Handed out {list.length}</span>
        <button className="deleg-fold" onClick={() => fold(true)} title="Fold">–</button>
      </div>
      <div className="deleg-cards">
        {list.map((d, i) => {
          const t = sessions.get(d.target);
          if (!t) return null;
          // the same session's earlier task is still open: this one waits behind it
          const queued = list.slice(0, i).some((x) => x.target === d.target);
          const busy = !queued && (t.status === 'working' || t.status === 'starting');
          // what was asked: the directive this task started with
          const asked = inbox.find((it) => it.kind === 'directive' && it.sessionId === d.target && it.fromId === id && (d.task ? it.taskId === d.task : it.createdAt === d.at));
          const summary = asked ? titleOf(asked) : '';
          return (
            <button key={`${d.task ?? ''}${d.target}`} className={`deleg-card ${queued ? 'queued' : busy ? 'busy' : ''}`} onClick={() => selectAndReveal(t.id)} title={`${summary}

Open ${t.title}`}>
              <span className="deleg-card-head">
                <span className={`status-dot ${statusClass(t)}`} />
                {d.task && <span className="deleg-task">{d.task}</span>}
                <span className="deleg-who ellipsis">{t.title}</span>
                <span
                  className="deleg-x"
                  role="button"
                  title="Not waiting on this any more"
                  onClick={(e) => { e.stopPropagation(); dismiss(d); window.dispatchEvent(new Event('asm-deleg-dismissed')); }}
                >×</span>
              </span>
              <span className="deleg-time">{queued ? 'Queued' : busy ? 'Working' : statusLabel(t)} · {relativeTime(d.at, now)}</span>
              {summary && <span className="deleg-summary">{summary}</span>}
              {busy && <Activity session={t} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FOLD_KEY = 'asm.delegFolded';
function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
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

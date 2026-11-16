import { useMemo } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { useOpenInbox } from '@/lib/closed';
import { useNow } from '@/lib/hooks';
import { displayTitle, relativeTime, rootProject, roleLabel } from '@/lib/format';
import { useNeedsIds } from './NeedsYou';
import { useDelegations } from './Delegations';

/**
 * Where a project is right now, in one place: each session's state (working, waiting on whom, waiting for the
 * manager, stuck, done) with the piece of work (#T) it has, and one line on top saying what is next. Nothing here asks
 * a session anything — it only reads what the app already knows.
 */
type State = 'working' | 'input' | 'you' | 'waiting' | 'stuck' | 'queued' | 'done' | 'idle' | 'off' | 'error';
interface Row {
  s: Session;
  state: State;
  label: string;
  detail: string;
  at: number;
  task?: string;
}

/** A request is "stuck" when its session has not started on it after this long. */
const STUCK_MS = 10 * 60_000;

const oneLine = (text: string, max = 100): string => {
  const body = text.replace(/^[^:\n]{0,160}?(?:→[^:\n]{0,80})?:\s*/, '').replace(/^\[[^\]]{0,120}\]\s*/, '').replace(/\*\*|`/g, '');
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

/** Timeline and Today have no cards: go back to the Ground, then fly to the session's card. */
function openOnGround(id: string): void {
  const st = useStore.getState();
  if (st.viewMode === 'today' || st.viewMode === 'timeline') st.setViewMode('board');
  selectAndReveal(id);
}

export function ProjectNow({ projectId }: { projectId: string }): JSX.Element | null {
  const sessions = useStore((st) => st.sessions);
  const projects = useStore((st) => st.projects);
  const inbox = useOpenInbox();
  const needs = useNeedsIds((st) => st.list);
  const byCoach = useDelegations((st) => st.byCoach);
  const now = useNow(30_000);

  const { rows, next } = useMemo(() => {
    const mine = [...sessions.values()].filter((s) => rootProject(s.projectId, projects)?.id === projectId);
    if (mine.length === 0) return { rows: [] as Row[], next: '' };
    const title = (id: string): string => (sessions.get(id) ? displayTitle(sessions.get(id)!) : id.slice(0, 8));
    // open hand-offs by who holds them
    const held = new Map<string, { from: string; at: number; task?: string }>();
    for (const [from, list] of byCoach) for (const d of list) held.set(d.target, { from, at: d.at, ...(d.task ? { task: d.task } : {}) });
    const lastIn = new Map<string, InboxItem>(); // the latest order a session received
    const lastReport = new Map<string, number>(); // its latest report
    for (const it of inbox) {
      if (it.kind === 'directive' && (!lastIn.get(it.sessionId) || it.createdAt > lastIn.get(it.sessionId)!.createdAt)) lastIn.set(it.sessionId, it);
      if (it.kind === 'report' && it.fromId) lastReport.set(it.fromId, Math.max(lastReport.get(it.fromId) ?? 0, it.createdAt));
    }
    const asks = new Map<string, number>();
    for (const n of needs) if (n.kind === 'question') asks.set(n.sessionId, (asks.get(n.sessionId) ?? 0) + 1);

    const rows: Row[] = mine.map((s) => {
      const order = lastIn.get(s.id);
      const task = order?.taskId;
      const doing = order ? oneLine(order.text) : '';
      const h = held.get(s.id);
      const out = byCoach.get(s.id) ?? [];
      const at = Math.max(s.updatedAt, lastReport.get(s.id) ?? 0);
      const row = (state: State, label: string, detail: string, t = task): Row => ({ s, state, label, detail, at, ...(t ? { task: t } : {}) });
      if (s.status === 'error') return row('error', 'Error', 'The session failed — open it');
      if (s.status === 'working' || s.status === 'starting') return row('working', 'Working', doing);
      if (s.permission !== undefined || (s.status === 'waiting' && s.attention)) return row('input', 'Needs input', 'Stopped on a prompt in its terminal');
      if (asks.get(s.id)) return row('you', 'Waiting for you', `${asks.get(s.id)} question${asks.get(s.id)! > 1 ? 's' : ''} in its last report`);
      if (out.length) return row('waiting', `Waiting on ${out.length}`, out.map((d) => title(d.target)).join(', '));
      if (h && now - h.at > STUCK_MS) return row('stuck', 'Not started', `${title(h.from)} sent this ${relativeTime(h.at, now)} — no answer`, h.task);
      if (h) return row('queued', 'Queued', `from ${title(h.from)}`, h.task);
      if (s.status === 'hibernated') return row('off', 'Off', lastReport.get(s.id) ? `last report ${relativeTime(lastReport.get(s.id)!, now)}` : '');
      return row(s.status === 'waiting' ? 'idle' : 'done', 'Idle', lastReport.get(s.id) ? `last report ${relativeTime(lastReport.get(s.id)!, now)}` : '');
    });
    const rank = (r: Row): number => (r.s.role === 'head' ? 0 : r.s.role === 'coach' ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || displayTitle(a.s).localeCompare(displayTitle(b.s)));

    const names = (list: Row[]): string => list.map((r) => displayTitle(r.s)).join(', ');
    const you = rows.filter((r) => r.state === 'you' || r.state === 'input');
    const stuck = rows.filter((r) => r.state === 'stuck');
    const busy = rows.filter((r) => r.state === 'working');
    const waiting = rows.filter((r) => r.state === 'waiting');
    const next = you.length
      ? `You: answer ${names(you)}`
      : stuck.length
        ? `Stuck: ${names(stuck)} has not started on its request — open it and press Enter, or ask the coach to resend`
        : busy.length
          ? `Working: ${names(busy)}`
          : waiting.length
            ? `Waiting on ${waiting.map((r) => r.detail).join('; ')}`
            : 'Nothing is waiting — every session is idle';
    return { rows, next };
  }, [sessions, projects, inbox, needs, byCoach, projectId, now]);

  if (rows.length === 0) return null;
  const tone = next.startsWith('You:') ? 'you' : next.startsWith('Stuck') ? 'stuck' : next.startsWith('Working') ? 'working' : 'idle';
  return (
    <div className="now-board" aria-label="Project status">
      <div className={`now-next ${tone}`}>
        <b>Now</b> {next}
      </div>
      <ul className="now-rows">
        {rows.map((r) => (
          <li key={r.s.id} className={`now-row ${r.state}`} onClick={() => openOnGround(r.s.id)} title={`Show ${displayTitle(r.s)} on the Ground`}>
            <span className={`now-dot ${r.state}`} />
            <span className="now-name ellipsis">
              {r.s.role !== 'player' && <span className="now-role">{roleLabel(r.s)}</span>}
              {displayTitle(r.s)}
            </span>
            <span className={`now-state ${r.state}`}>{r.label}</span>
            {r.task && <span className="task-id chat-task">{r.task}</span>}
            <span className="now-detail ellipsis">{r.detail}</span>
            <span className="now-at">{r.at ? relativeTime(r.at, now) : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

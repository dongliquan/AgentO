import { useMemo } from 'react';
import type { InboxItem, Project, Session, TaskRec, TaskState } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { send } from '@/client';
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
  const ledger = useStore((st) => st.ledger);
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
    // the daemon's own record of a question (report_up needs_answer) counts without any guessing from the words
    const asked = new Set<string>();
    for (const r of ledger.values()) if (r.state === 'asking' && r.projectId === projectId) asked.add(r.to);
    for (const id of asked) if (!asks.get(id)) asks.set(id, 1);

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
  }, [sessions, projects, inbox, needs, byCoach, ledger, projectId, now]);

  const tasks = useMemo(() => openTasks(ledger, projectId, now), [ledger, projectId, now]);

  const project = projects.find((p) => p.id === projectId);
  if (rows.length === 0) return null;
  const tone = next.startsWith('You:') ? 'you' : next.startsWith('Stuck') ? 'stuck' : next.startsWith('Working') ? 'working' : 'idle';
  return (
    <div className="now-board" aria-label="Project status">
      <div className={`now-next ${tone}`}>
        <span className="now-next-text">
          <b>Now</b> {next}
        </span>
        {project && <AutopilotSwitch project={project} now={now} />}
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
      {tasks.length > 0 && (
        <div className="now-tasks" aria-label="Open tasks">
          <h5>Tasks <span className="muted">{tasks.length} open</span></h5>
          <ul className="now-rows">
            {tasks.map((t) => (
              <li key={t.key} className={`now-row task ${TASK_TONE[t.state]}`} onClick={() => openOnGround(t.to)} title={t.note || t.summary}>
                <span className={`now-dot ${TASK_TONE[t.state]}`} />
                <span className="task-id chat-task">{t.id}</span>
                <span className="now-name ellipsis">{sessions.get(t.to) ? displayTitle(sessions.get(t.to)!) : t.to.slice(0, 8)}</span>
                <span className={`now-state ${TASK_TONE[t.state]}`}>{TASK_LABEL[t.state]}</span>
                <span className="now-detail ellipsis">
                  {t.from === 'user' ? '' : `from ${sessions.get(t.from) ? displayTitle(sessions.get(t.from)!) : t.from.slice(0, 8)} · `}
                  {t.state === 'asking' || t.state === 'blocked' ? t.note || t.summary : t.summary}
                </span>
                <span className="now-at">{relativeTime(t.stateAt, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const TASK_LABEL: Record<TaskState, string> = { queued: 'Queued', working: 'Working', handed: 'Handed on', reported: 'Reported', asking: 'Asking', blocked: 'Blocked' };
const TASK_TONE: Record<TaskState, State> = { queued: 'queued', working: 'working', handed: 'waiting', reported: 'done', asking: 'you', blocked: 'stuck' };
const TASK_RANK: Record<TaskState, number> = { asking: 0, blocked: 1, working: 2, queued: 3, handed: 4, reported: 5 };
/** a task nobody touched for this long is old news, whatever state it was left in */
const TASK_STALE_MS = 7 * 86_400_000;

/** The ledger's open tasks of a project: waiting for an answer first, then stuck, working, queued, handed on. */
function openTasks(ledger: Map<string, TaskRec>, projectId: string, now: number): TaskRec[] {
  return [...ledger.values()]
    .filter((r) => r.projectId === projectId && r.state !== 'reported' && now - r.stateAt < TASK_STALE_MS)
    .sort((a, b) => TASK_RANK[a.state] - TASK_RANK[b.state] || b.stateAt - a.stateAt);
}

/** Autopilot: the Coach decides open questions itself and is told to carry on while the manager is away. */
function AutopilotSwitch({ project, now }: { project: Project; now: number }): JSX.Element {
  const ap = project.autopilot;
  const on = ap?.on === true;
  const toggle = (): void => {
    if (on) {
      send({ type: 'project.autopilot', id: project.id, on: false });
      return;
    }
    const ok = window.confirm(
      `Switch Autopilot on for "${project.name}"?

The Coach decides open questions itself (recommended option, written to the project memory) and is told to carry on while you are away. It stops by itself when the plan is finished, after ${6} continues in an hour, or after 2 continues without progress.

Tokens keep being used until then.`
    );
    if (ok) send({ type: 'project.autopilot', id: project.id, on: true });
  };
  const status = on
    ? `on${ap?.continues ? ` · continued ${ap.continues}×` : ''}${ap?.lastAt ? ` · ${relativeTime(ap.lastAt, now)}` : ''}`
    : ap?.note
      ? `off — ${ap.note}`
      : 'off';
  return (
    <button className={`ap-switch ${on ? 'on' : ''}`} onClick={toggle} title={on ? 'Autopilot is on: click to switch it off' : 'Autopilot: let the Coach keep the project going while you are away'}>
      <i className="ap-dot" />
      Autopilot <span className="ap-status ellipsis">{status}</span>
    </button>
  );
}

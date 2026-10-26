import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { useOpenThreads } from '@/lib/closed';
import { buildTimeline, featureName, isFeature } from '@/lib/timeline';
import { pcStyle, projectColor, relativeTime, rootProject, statusClass } from '@/lib/format';
import { useGitSubjects } from '@/lib/gitSubjects';
import { useNow } from '@/lib/hooks';
import { selectAndReveal } from '@/commands';
import { useNeedsIds, openNeed } from './NeedsYou';
import { useDelegations } from './Delegations';
import { useFlow } from './OrderFlow';
import { useReport, useTodos, saveTodos, newTodo } from './DailyReport';

const NEED_LABEL = { prompt: 'Prompt', question: 'Question', context: 'Large chat' } as const;

/**
 * Today — the manager's home: what needs an answer, who is working on what, the features finished today, and the
 * to-do list for today. Built only from what AgentO already has (sessions, the team records, the report's to-dos);
 * nothing here asks a session anything.
 */
export function TodayView(): JSX.Element {
  const now = useNow(60_000);
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const threads = useOpenThreads();
  const subjects = useGitSubjects((s) => s.subjects);
  const needs = useNeedsIds((s) => s.list);
  const delegations = useDelegations((s) => s.byCoach);
  const openFlow = useFlow((s) => s.open);
  const todos = useTodos();
  const [draft, setDraft] = useState('');

  const dayStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now]);
  const today = new Date(now).toDateString();

  const projectOf = (sessionId: string): { name: string; color: string } | undefined => {
    const s = sessions.get(sessionId);
    const p = s ? rootProject(s.projectId, projects) : undefined;
    return p ? { name: p.name, color: projectColor(p.id, projects) } : undefined;
  };

  // working now: sessions in a turn, coordinators with work handed out
  const working = useMemo(
    () =>
      [...sessions.values()]
        .filter((s) => s.status === 'working' || s.status === 'starting' || (delegations.get(s.id)?.length ?? 0) > 0)
        .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working') || a.title.localeCompare(b.title)),
    [sessions, delegations]
  );

  // finished today: the timeline's features since midnight, by project
  const done = useMemo(() => {
    const tl = buildTimeline(threads, sessions, projects, dayStart);
    return tl
      .map((p) => ({ ...p, rows: p.rows.filter((r) => r.kind === 'feature' && r.ts >= dayStart && isFeature(r)) }))
      .filter((p) => p.rows.length > 0);
  }, [threads, sessions, projects, dayStart]);
  const doneCount = done.reduce((n, p) => n + p.rows.length, 0);

  const todayTodos = todos.filter((t) => t.day === today || (!t.doneAt && new Date(t.day).getTime() < dayStart));
  const openTodos = todayTodos.filter((t) => !t.doneAt).length;

  const addTodo = (): void => {
    const text = draft.trim();
    if (!text) return;
    saveTodos([...todos, newTodo(text, today)]);
    setDraft('');
  };
  const toggle = (id: string): void => saveTodos(todos.map((t) => (t.id === id ? { ...t, doneAt: t.doneAt ? undefined : Date.now(), day: today } : t)));

  return (
    <div className="today">
      <div className="today-head">
        <h2>Today</h2>
        <span className="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <span className="today-sum">
          <b className={needs.length ? 'warn' : ''}>{needs.length}</b> need you · <b>{working.filter((s) => s.status === 'working').length}</b> working · <b>{doneCount}</b> done · <b>{openTodos}</b> to do
        </span>
        <span className="grow" />
        <button className="btn sm" onClick={() => useReport.getState().show()} title="The Report — any day's done list and to-dos">
          Report
        </button>
      </div>
      <div className="today-grid">
        <section className="today-card needs">
          <h3>Needs you <span className="count">{needs.length}</span></h3>
          {needs.length === 0 && <div className="muted today-empty">Nothing waits for you.</div>}
          {needs.map((n) => {
            const s = sessions.get(n.sessionId);
            const p = projectOf(n.sessionId);
            return (
              <button key={n.key} className="today-row" onClick={() => openNeed(n.sessionId)} title={n.text}>
                <span className={`today-kind k-${n.kind}`}>{NEED_LABEL[n.kind]}</span>
                {p && <span className="today-proj" style={pcStyle(p.color)}>{p.name}</span>}
                <span className="today-title ellipsis">{s?.title ?? '(removed)'}</span>
                <span className="today-text ellipsis muted">{n.text.replace(/\s+/g, ' ')}</span>
                <span className="today-time muted">{relativeTime(n.at, now)}</span>
              </button>
            );
          })}
        </section>

        <section className="today-card working">
          <h3>Working now <span className="count">{working.length}</span></h3>
          {working.length === 0 && <div className="muted today-empty">Nobody is working right now.</div>}
          {working.map((s) => {
            const p = projectOf(s.id);
            const handed = delegations.get(s.id)?.length ?? 0;
            return (
              <button key={s.id} className="today-row" onClick={() => selectAndReveal(s.id)}>
                <span className={`status-dot ${statusClass(s)}`} />
                {p && <span className="today-proj" style={pcStyle(p.color)}>{p.name}</span>}
                <span className="today-title ellipsis">{s.title}</span>
                <span className="today-text muted">{s.status === 'working' || s.status === 'starting' ? 'working' : ''}{handed ? `${s.status === 'working' ? ' · ' : ''}→ ${handed} handed out` : ''}</span>
              </button>
            );
          })}
        </section>

        <section className="today-card done">
          <h3>Done today <span className="count">{doneCount}</span></h3>
          {doneCount === 0 && <div className="muted today-empty">No feature finished yet today.</div>}
          {done.map((p) => (
            <div key={p.projectId} className="today-group" style={pcStyle(p.color)}>
              <div className="today-group-name">{p.name}</div>
              {p.rows.map((r) => (
                <button key={r.key} className="today-row" onClick={() => openFlow(r.order)} title="Flow — who did it, and how it was reported">
                  <span className="today-check">✓</span>
                  <span className="today-title ellipsis">{featureName(r, subjects)}</span>
                  <span className="today-text muted ellipsis">{r.sessionId ? sessions.get(r.sessionId)?.title ?? '' : ''}</span>
                  <span className="today-time muted">{new Date(r.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ))}
            </div>
          ))}
        </section>

        <section className="today-card todo">
          <h3>To do <span className="count">{openTodos}</span></h3>
          {todayTodos.map((t) => (
            <label key={t.id} className={`today-todo ${t.doneAt ? 'checked' : ''}`}>
              <input type="checkbox" checked={!!t.doneAt} onChange={() => toggle(t.id)} />
              <span className="ellipsis">{t.text}</span>
              {t.day !== today && !t.doneAt && <span className="muted today-carried">carried over</span>}
            </label>
          ))}
          <div className="today-add">
            <input value={draft} placeholder="Add a to-do for today…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addTodo(); }} />
            <button className="btn sm" disabled={!draft.trim()} onClick={addTodo}>Add</button>
          </div>
        </section>
      </div>
    </div>
  );
}

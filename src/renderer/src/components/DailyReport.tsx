import { useMemo, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { useStore } from '@/store';
import { send } from '@/client';
import { useEscape } from '@/lib/hooks';
import { useOpenThreads } from '@/lib/closed';
import { buildTimeline, changelogs, featureGroups, featureName, isFeature } from '@/lib/timeline';
import { displayTitle, pcStyle } from '@/lib/format';
import { useGitSubjects } from '@/lib/gitSubjects';
import { copyPath } from './PathMenu';
import { useNeedsIds } from './NeedsYou';

const DAY = 86_400_000;

/** The Report window (Manager row ▸ Report, Timeline ▸ Today's report). */
export const useReport = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}));

/* ---------- the manager's to-do list, by day (kept in this browser) ---------- */

interface Todo {
  id: string;
  text: string;
  /** the day it is planned for (Date.toDateString) */
  day: string;
  /** when it was checked off (that day's "done") */
  doneAt?: number;
  /** the project it goes to as an order */
  projectId?: string;
  /** sent to the project's coach (now), or scheduled for 09:00 */
  sentAt?: number;
  scheduled?: string;
}
const KEY = 'asm.report.todos';
let todos: Todo[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Todo[];
  } catch {
    return [];
  }
})();
const subs = new Set<() => void>();
function saveTodos(next: Todo[]): void {
  todos = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next.slice(-1000)));
  } catch {
    /* not kept */
  }
  subs.forEach((f) => f());
}
const useTodos = (): Todo[] =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => todos
  );

const dayKey = (ms: number): string => new Date(ms).toDateString();
const startOf = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const label = (ms: number): string => {
  const k = dayKey(ms);
  if (k === dayKey(Date.now())) return 'Today';
  if (k === dayKey(Date.now() - DAY)) return 'Yesterday';
  if (k === dayKey(Date.now() + DAY)) return 'Tomorrow';
  return new Date(ms).toLocaleDateString();
};

/**
 * Report: for a chosen day, what was done (the features each project finished that day, from the team records, plus
 * the to-dos checked off) and what to do next (a to-do list for the next day: the manager's own items, unfinished ones
 * carried over, and the work still open / waiting on the manager). No tokens.
 */
export function DailyReport(): JSX.Element | null {
  const open = useReport((s) => s.open);
  const hide = useReport((s) => s.hide);
  useEscape(open, hide);
  if (!open) return null;
  return <ReportBody onClose={hide} />;
}

function ReportBody({ onClose }: { onClose: () => void }): JSX.Element {
  const [day, setDay] = useState(() => startOf(Date.now()));
  const threads = useOpenThreads();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const needs = useNeedsIds((s) => s.list);
  const subjects = useGitSubjects((s) => s.subjects);
  const list = useTodos();
  const [draft, setDraft] = useState('');
  const isToday = dayKey(day) === dayKey(Date.now());
  const next = day + DAY;

  // the day's finished features per project (the period reaches back to the chosen day)
  const timelines = useMemo(() => buildTimeline(threads, sessions, projects, day), [threads, sessions, projects, day]);
  const logs = useMemo(() => changelogs(threads, sessions, projects), [threads, sessions, projects]);
  const who = (id?: string): string => {
    const s = id ? sessions.get(id) : undefined;
    return s ? displayTitle(s) : '';
  };
  const done = timelines
    .map((t) => {
      // features only, as on the Timeline (not answers or look-ups) — grouped by feature, whoever did them
      const rows = t.rows.filter((r) => isFeature(r) && r.ts >= day && r.ts < next);
      return { t, rows, groups: featureGroups(rows, subjects), summary: logs.get(t.projectId)?.get(dayKey(day)) };
    })
    .filter((p) => p.rows.length || p.summary);
  // days with finished features, for the calendar's dots (a month around the chosen day)
  const [calOpen, setCalOpen] = useState(false);
  const busy = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of buildTimeline(threads, sessions, projects, startOf(day) - 45 * DAY)) for (const r of t.rows) if (isFeature(r)) m.set(dayKey(r.ts), (m.get(dayKey(r.ts)) ?? 0) + 1);
    return m;
  }, [threads, sessions, projects, day]);
  const checked = list.filter((x) => x.doneAt !== undefined && dayKey(x.doneAt) === dayKey(day));
  // to do for the next day: planned for it, plus anything unfinished from before (carried over)
  const planned = list.filter((x) => x.doneAt === undefined && startOf(new Date(x.day).getTime()) <= next);
  // what the team still has open, and what waits on the manager (now — only on today's report)
  const rootOf = (sessionId: string): string | undefined => {
    const s = sessions.get(sessionId);
    const p = s ? projects.find((x) => x.id === s.projectId) : undefined;
    return p?.parentId ?? p?.id;
  };
  const openWork = isToday
    ? timelines.map((t) => ({ t, rows: t.rows.filter((r) => r.kind === 'open'), waiting: needs.filter((n) => rootOf(n.sessionId) === t.projectId) })).filter((p) => p.rows.length || p.waiting.length)
    : [];

  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    saveTodos([...todos, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, day: dayKey(next) }]);
    setDraft('');
  };
  const check = (t: Todo, on: boolean): void => saveTodos(todos.map((x) => (x.id === t.id ? (on ? { ...x, doneAt: isToday ? Date.now() : day + DAY / 2 } : { id: x.id, text: x.text, day: x.day }) : x)));
  const remove = (t: Todo): void => saveTodos(todos.filter((x) => x.id !== t.id));
  const patch = (t: Todo, p: Partial<Todo>): void => saveTodos(todos.map((x) => (x.id === t.id ? { ...x, ...p } : x)));
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  // a to-do becomes an order to its project's coach: now, or once at 09:00 (the daemon sends it even with the window closed)
  const sendNow = (t: Todo): void => {
    if (!t.projectId) return;
    send({ type: 'team.order', target: { kind: 'project', projectId: t.projectId }, text: t.text });
    patch(t, { sentAt: Date.now() });
  };
  const schedule = (t: Todo): void => {
    if (!t.projectId) return;
    send({ type: 'routine.save', routine: { name: `To-do · ${t.text.slice(0, 40)}`, target: { kind: 'project', projectId: t.projectId }, text: t.text, dailyAt: '09:00', enabled: true, once: true } });
    patch(t, { scheduled: '09:00' });
  };

  const asText = (): string =>
    [
      `# Report — ${new Date(day).toLocaleDateString()}`,
      '',
      '## Done',
      ...done.flatMap((p) => [`### ${p.t.name}`, ...p.groups.map((g) => `- ${g.title}${g.rows.length > 1 ? ` (${g.rows.length} changes)` : ''}`)]),
      ...checked.map((x) => `- [x] ${x.text}`),
      '',
      `## To do (${new Date(next).toLocaleDateString()})`,
      ...planned.map((x) => `- [ ] ${x.text}`),
      ...openWork.flatMap((p) => [`### ${p.t.name}`, ...p.waiting.map((n) => `- [ ] Waiting on you: ${who(n.sessionId)}`), ...p.rows.map((r) => `- [ ] ${featureName(r, subjects)} — ${who(r.sessionId)}`)])
    ].join('\n');

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog daily-report" role="dialog" aria-label="Report">
        <div className="dr-head">
          <h3>Report</h3>
          <div className="dr-nav">
            <button className="btn sm ghost" onClick={() => setDay(day - DAY)} title="Previous day">◀</button>
            <button className="dr-date" onClick={() => setCalOpen(!calOpen)} title="Pick a day">
              <b>{label(day)}</b> <span className="muted">{new Date(day).toLocaleDateString()}</span> ▾
            </button>
            <button className="btn sm ghost" onClick={() => setDay(day + DAY)} disabled={isToday} title="Next day">▶</button>
            {!isToday && <button className="btn sm ghost" onClick={() => setDay(startOf(Date.now()))}>Today</button>}
            {calOpen && <Calendar value={day} busy={busy} onPick={(d) => { setDay(d); setCalOpen(false); }} onClose={() => setCalOpen(false)} />}
          </div>
          <span className="grow" />
          <button className="btn sm" onClick={() => copyPath(asText(), 'Report')}>Copy</button>
          <button className="icon-btn dialog-x" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>
        <div className="dr-cols dr-main">
          <div className="dr-col">
            <div className="dr-label">Done · {label(day)}</div>
            {done.length === 0 && checked.length === 0 && <div className="muted dr-none">Nothing finished this day.</div>}
            {done.map((p) => (
              <section key={p.t.projectId} className="dr-project" style={pcStyle(p.t.color)}>
                <div className="dr-name"><span className="pc-dot" /> <b>{p.t.name}</b> <span className="muted">{p.groups.length} feature{p.groups.length === 1 ? '' : 's'}</span></div>
                <ul className="dr-list">
                  {p.groups.map((g) => (
                    <li key={g.key} className="dr-feature">
                      <span className="dr-check on">✓</span>
                      {g.rows.length > 1 ? (
                        <details>
                          <summary>{g.title} <span className="muted">· {g.rows.length} changes</span></summary>
                          <ul>{g.rows.map((r) => <li key={r.key}>{featureName(r, subjects)}</li>)}</ul>
                        </details>
                      ) : (
                        <span>{g.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {p.summary && (
                  <details className="dr-summary">
                    <summary>Coach summary</summary>
                    <pre>{p.summary}</pre>
                  </details>
                )}
              </section>
            ))}
            {checked.length > 0 && (
              <section className="dr-project dr-mine">
                <div className="dr-name"><b>My to-dos</b> <span className="muted">{checked.length}</span></div>
                <ul className="dr-list">
                  {checked.map((x) => (
                    <li key={x.id}>
                      <label><input type="checkbox" checked onChange={() => check(x, false)} /> <s>{x.text}</s></label>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="dr-col">
            <div className="dr-label">To do · {label(next)}</div>
            <div className="dr-add">
              <input value={draft} placeholder="Add a to-do…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
              <button className="btn sm primary" onClick={add} disabled={!draft.trim()}>Add</button>
            </div>
            <ul className="dr-list dr-todos">
              {planned.map((x) => (
                <li key={x.id} className="dr-todo">
                  <label><input type="checkbox" onChange={() => check(x, true)} /> {x.text}</label>
                  {startOf(new Date(x.day).getTime()) < next && <span className="dr-carried" title={`Planned for ${x.day}`}>carried over</span>}
                  <select className="dr-proj" value={x.projectId ?? ''} onChange={(e) => patch(x, { projectId: e.target.value || undefined })} title="The project it goes to as an order">
                    <option value="">Just a note</option>
                    {tops.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {x.sentAt ? (
                    <span className="dr-sent" title={new Date(x.sentAt).toLocaleString()}>sent</span>
                  ) : x.scheduled ? (
                    <span className="dr-sent" title="Sent once at 09:00 by AgentO (even with this window closed)">⏰ {x.scheduled}</span>
                  ) : (
                    <>
                      <button className="btn sm ghost" disabled={!x.projectId} onClick={() => sendNow(x)} title="Send it to the project's coach now">▶ Send</button>
                      <button className="btn sm ghost" disabled={!x.projectId} onClick={() => schedule(x)} title="Send it to the project's coach at 09:00 (once)">⏰ 09:00</button>
                    </>
                  )}
                  <button className="icon-btn dr-del" title="Remove" onClick={() => remove(x)}>×</button>
                </li>
              ))}
            </ul>
            {openWork.map((p) => (
              <section key={p.t.projectId} className="dr-project" style={pcStyle(p.t.color)}>
                <div className="dr-name"><span className="pc-dot" /> <b>{p.t.name}</b> <span className="muted">open work</span></div>
                <ul className="dr-list">
                  {p.waiting.map((n) => (
                    <li key={n.key} className="dr-waiting"><span className="dr-check">!</span> Waiting on you · {who(n.sessionId)}</li>
                  ))}
                  {p.rows.map((r) => (
                    <li key={r.key}><span className="dr-check" /> {featureName(r, subjects)} <span className="muted">— {who(r.sessionId)}</span></li>
                  ))}
                </ul>
              </section>
            ))}
            {planned.length === 0 && openWork.length === 0 && <div className="muted dr-none">Nothing planned — add a to-do above.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A month calendar to pick the report's day; days with finished features carry a dot and their count. */
function Calendar({ value, busy, onPick, onClose }: { value: number; busy: Map<string, number>; onPick: (day: number) => void; onClose: () => void }): JSX.Element {
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const m = new Date(month);
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const startPad = first.getDay();
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1).getTime())];
  const today = startOf(Date.now());
  return (
    <>
      <div className="fileref-scrim" onMouseDown={onClose} />
      <div className="popover dr-cal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dr-cal-head">
          <button className="icon-btn" onClick={() => setMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1).getTime())}>‹</button>
          <b>{m.getFullYear()}-{String(m.getMonth() + 1).padStart(2, '0')}</b>
          <button className="icon-btn" onClick={() => setMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime())} disabled={month >= new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()}>›</button>
        </div>
        <div className="dr-cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} className="dr-cal-w">{w}</span>)}
          {cells.map((d, i) =>
            d === null ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                className={`dr-cal-d ${d === startOf(value) ? 'on' : ''} ${d === today ? 'today' : ''}`}
                disabled={d > today}
                onClick={() => onPick(d)}
                title={busy.get(dayKey(d)) ? `${busy.get(dayKey(d))} features` : ''}
              >
                {new Date(d).getDate()}
                {busy.get(dayKey(d)) ? <i>{busy.get(dayKey(d))}</i> : null}
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

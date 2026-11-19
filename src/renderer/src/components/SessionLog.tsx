import { useMemo, useRef, useState } from 'react';
import type { InboxItem, TaskRec, TaskState } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { formatDateTime, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { matches, useHighlight } from '@/lib/search';
import { useOpenInbox } from '@/lib/closed';
import { useTalkProject } from '@/lib/talkFilter';
import { ProjectFilter, useProjectFilter } from './ProjectFilter';
import { RECENT_MS, RecentToggle, useRecentOnly } from './RecentToggle';
import { SearchBox } from './SearchBox';

const STATE_LABEL: Record<TaskState, string> = {
  queued: 'Queued',
  working: 'Working',
  handed: 'Handed on',
  reported: 'Answered',
  asking: 'Asking',
  blocked: 'Blocked'
};

const MAX_TASKS = 300;
const MAX_TEXT = 700;

/**
 * What the sessions asked of each other: every request one session sent another (send_to_session, its #T number), who
 * has the work, how it stands, and the messages that went back and forth — the record the Ground's links come from.
 * What the manager typed into a session is in the Inbox, not here.
 */
export function SessionLog(): JSX.Element {
  const ledger = useStore((s) => s.ledger);
  const sessions = useStore((s) => s.sessions);
  const inbox = useOpenInbox();
  const now = useNow(15000);
  const [query, setQuery] = useState('');
  const [recentOnly, setRecentOnly] = useRecentOnly();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const pick = useTalkProject((s) => s.project);
  const setPick = useTalkProject((s) => s.setProject);
  const { only, rootOf } = useProjectFilter(pick);
  const body = useRef<HTMLDivElement>(null);

  const title = (id: string): string => (id === 'user' ? 'You' : sessions.get(id)?.title ?? 'a removed session');

  // the messages of each request: its directive (to the worker) and the reports that came back
  const byTask = useMemo(() => {
    const m = new Map<string, InboxItem[]>();
    for (const it of inbox) {
      if ((it.kind !== 'directive' && it.kind !== 'report') || !it.taskId) continue;
      const key = `${rootOf(it.sessionId) ?? ''}/${it.taskId}`;
      const list = m.get(key) ?? [];
      list.push(it);
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, sessions]);

  // requests between sessions (what the manager typed into a session is in the Inbox), in the chosen project
  const scoped = useMemo(() => {
    return [...ledger.values()]
      .filter((t) => t.from !== 'user')
      .filter((t) => !only || rootOf(t.to) === only || rootOf(t.from) === only)
      .sort((a, b) => b.createdAt - a.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, sessions, only]);
  const cutoff = Date.now() - RECENT_MS;
  const older = recentOnly ? scoped.filter((t) => t.createdAt < cutoff).length : 0;
  const tasks = useMemo(() => {
    return scoped
      .filter((t) => !recentOnly || t.createdAt >= cutoff)
      .filter((t) => matches(query, t.summary, title(t.from), title(t.to), t.id))
      .slice(0, MAX_TASKS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, sessions, query, recentOnly]);
  useHighlight(body, query, [tasks.length]);

  const toggle = (key: string): void => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
  };

  const chip = (id: string): JSX.Element =>
    id === 'user' || !sessions.has(id) ? (
      <span className="log-chip static">{title(id)}</span>
    ) : (
      <button className="log-chip" onClick={() => selectAndReveal(id)} title="Show this session">
        {title(id)}
      </button>
    );

  return (
    <div className="rp-pane">
      <div className="filter-bar">
        <ProjectFilter value={pick} onChange={setPick} />
        <RecentToggle value={recentOnly} onChange={setRecentOnly} hidden={older} />
        <SearchBox value={query} onChange={setQuery} count={tasks.length} placeholder="Search the logs" />
      </div>
      <div className="rp-body" ref={body}>
        {tasks.length === 0 ? (
          <div className="muted dock-empty">
            No requests between sessions yet. When a session asks another with send_to_session, the request and its answer show up here.
          </div>
        ) : (
          tasks.map((t: TaskRec) => {
            const msgs = byTask.get(t.key) ?? [];
            const shown = open.has(t.key);
            return (
              <div key={t.key} className={`log-task st-${t.state}`}>
                <div className="log-head">
                  <span className="task-id">{t.id}</span>
                  {chip(t.from)}
                  <span className="log-arrow">→</span>
                  {chip(t.to)}
                  <span className={`log-state s-${t.state}`}>{STATE_LABEL[t.state]}</span>
                  <span className="grow" />
                  <span className="muted log-time" title={formatDateTime(t.createdAt)}>{relativeTime(t.createdAt, now)}</span>
                </div>
                <div className="log-summary">{t.summary}</div>
                {t.note && <div className="log-note muted">{t.note}</div>}
                {msgs.length > 0 && (
                  <button className="log-toggle" onClick={() => toggle(t.key)}>
                    {shown ? '▾ Hide' : '▸ Show'} {msgs.length} message{msgs.length > 1 ? 's' : ''}
                  </button>
                )}
                {shown &&
                  msgs.map((m) => (
                    <div key={m.id} className={`log-msg k-${m.kind}`}>
                      <div className="muted log-msg-head">
                        {m.kind === 'directive' ? 'Request' : 'Answer'} · {formatDateTime(m.createdAt)}
                      </div>
                      <div className="log-msg-text">{m.text.length > MAX_TEXT ? `${m.text.slice(0, MAX_TEXT)}…` : m.text}</div>
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

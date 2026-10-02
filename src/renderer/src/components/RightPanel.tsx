import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem, Routine, Session } from '@shared/protocol';
import { unreadCount, useStore } from '@/store';
import { requestChanged, send } from '@/client';
import { exportSession, focusTerminal, removeSession, selectAndReveal } from '@/commands';
import { AGENT_LABELS, STATUS_LABELS, projectLabel, roleLabel, displayTitle, basename, formatDateTime, formatTime, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { StatusBadge } from './StatusBadge';
import { AgentIcon } from './AgentIcon';
import { ChatView } from './ChatView';
import { TeamLog } from './TeamLog';
import { MyOrders } from './MyOrders';
import { TaskList } from './TaskList';
import { useOpenInbox as useTaskInbox } from '@/lib/closed';
import { buildThreads, orderStatus } from '@/lib/threads';
import { lastLines } from '@/lib/ansi';
import { matches, selecting, useHighlight } from '@/lib/search';
import { useOpenInbox } from '@/lib/closed';
import { CopyButton, SearchBox } from './SearchBox';
import { useDraft } from '@/lib/draft';
import { pcStyle, projectColor } from '@/lib/format';
import { imageFiles, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachButton, AttachmentBar } from './AttachmentBar';

export function RightPanel(): JSX.Element {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const unread = useStore(unreadCount);
  const session = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId) : undefined));
  const tab = rightTab === 'detail' && !session ? 'orders' : rightTab;
  // Tasks badge: orders whose report came back and that are not closed yet
  const taskInbox = useTaskInbox();
  const sessionsAll = useStore((s) => s.sessions);
  const doneOrders = useStore((s) => s.doneOrders);
  const toReview = useMemo(
    () => buildThreads(taskInbox).filter((t) => t.item.fromId === 'user' && !doneOrders[t.item.id] && orderStatus(t, sessionsAll) === 'reported').length,
    [taskInbox, sessionsAll, doneOrders]
  );

  return (
    <div className="rightpanel">
      <div className="rp-tabs">
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setRightTab('orders')} title="Give orders · routines">Orders</button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setRightTab('tasks')} title="Your orders: what is open, reported, done">
          Tasks{toReview > 0 && <span className="badge inline" title="Reports to review">{toReview}</span>}
        </button>
        <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setRightTab('inbox')}>
          Inbox{unread > 0 && <span className="badge inline">{unread}</span>}
        </button>
        <button className={tab === 'detail' ? 'active' : ''} onClick={() => setRightTab('detail')} disabled={!session}>Session</button>
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setRightTab('log')} title="Everything the team sent each other, by order">Log</button>
      </div>
      {tab === 'detail' && session ? <Detail session={session} /> : tab === 'orders' ? <Orders /> : tab === 'tasks' ? <TaskList /> : tab === 'log' ? <TeamLog /> : <Inbox />}
    </div>
  );
}

/**
 * Session details: the session's own conversation (the card's Chat view, or the terminal's last lines for non-Claude
 * agents) with a message box, so the session can be followed and answered here even when the Ground is zoomed out.
 * Folder, ids, status history and changed files sit in a collapsible section below.
 */
function Detail({ session: s }: { session: Session }): JSX.Element {
  const projects = useStore((st) => st.projects);
  const timeline = useStore((st) => st.timeline);
  const changed = useStore((st) => st.changed.get(s.cwd));
  const openFileCard = useStore((st) => st.openFileCard);
  const openViewerTab = useStore((st) => st.openViewerTab);
  const buffer = useStore((st) => (s.agent === 'claude' ? '' : st.buffers.get(s.id) ?? ''));
  const project = projects.find((p) => p.id === s.projectId);
  const folder = project?.folders.find((f) => f.id === s.folderId);
  const entries = timeline.filter((t) => t.sessionId === s.id).slice(-20).reverse();
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number | undefined>(undefined);
  const termRef = useRef<HTMLPreElement>(null);
  const termLines = s.agent === 'claude' ? [] : lastLines(buffer, 200).filter((l) => matches(query, l));
  useHighlight(termRef, query, [buffer]);
  useEffect(() => setQuery(''), [s.id]);

  useEffect(() => {
    requestChanged(s.cwd);
  }, [s.cwd, s.status]);

  const live = s.status === 'working' || s.status === 'waiting' || s.status === 'starting';
  const openTerminal = (): void => {
    selectAndReveal(s.id);
    setTimeout(() => focusTerminal(s.id), 100);
  };

  return (
    <>
      <div className="rp-detail-head">
        <div className="rp-title">
          <AgentIcon kind={s.agent} color={s.color} size={16} />
          <span className="ellipsis" style={{ flex: 1 }} title={s.title}>{displayTitle(s)}</span>
          <StatusBadge status={s.status} />
        </div>
        <div className="rp-meta">
          {s.role !== 'player' && <span className={`role-tag ${s.role}`}>{roleLabel(s)}</span>}
          <span>{projectLabel(s.projectId, projects)}</span>
          <span className="muted">· {AGENT_LABELS[s.agent]}</span>
          <span className="grow" />
          <button className="btn sm ghost" onClick={openTerminal}>Terminal</button>
          <button className="btn sm ghost" onClick={() => send({ type: 'session.restart', id: s.id })}>Restart</button>
          {s.status === 'hibernated' ? (
            <button className="btn sm ghost" onClick={() => send({ type: 'session.resume', id: s.id })}>Resume</button>
          ) : (
            <button className="btn sm ghost" disabled={!live} onClick={() => send({ type: 'session.stop', id: s.id })}>Stop</button>
          )}
          <button className="btn sm ghost danger" onClick={() => removeSession(s.id)} title="Remove Session (Delete)">Remove</button>
        </div>
      </div>
      <SearchBox value={query} onChange={setQuery} count={s.agent === 'claude' ? hits : termLines.length} placeholder="Search this conversation" />
      <div className="rp-conversation">
        {s.agent === 'claude' ? (
          <ChatView session={s} onShowTerminal={openTerminal} query={query} onMatches={setHits} />
        ) : (
          <pre className="rp-term-preview" ref={termRef}>{termLines.join('\n') || (query ? 'No matches' : 'No output')}</pre>
        )}
      </div>
      <div className={`rp-more ${more ? 'open' : ''}`}>
        <button className="rp-more-toggle" onClick={() => setMore(!more)}>
          {more ? '▾' : '▸'} Details · status history · changed files{changed && changed.length ? ` (${changed.length})` : ''}
        </button>
        {more && (
          <div className="rp-more-body">
            <div className="kv">
              <span className="k">Folder</span><span className="v mono" style={{ fontSize: 11 }} title={s.cwd}>{folder?.path ?? s.cwd}</span>
              <span className="k">Started</span><span className="v">{formatDateTime(s.createdAt)}</span>
              <span className="k">Session ID</span><span className="v mono" style={{ fontSize: 11 }}>{s.id}</span>
              <span className="k">PID</span><span className="v mono">{s.pid ?? '-'}</span>
              {s.resumeId && (<><span className="k">Resume ID</span><span className="v mono" style={{ fontSize: 11 }}>{s.resumeId}</span></>)}
              {s.exitCode !== undefined && (<><span className="k">Exit Code</span><span className="v mono">{s.exitCode}</span></>)}
            </div>
            <h4>Status History</h4>
            {entries.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>No history</div>
            ) : (
              <div className="timeline">
                {entries.map((t) => (
                  <div className="t" key={t.id}>
                    <span className="time">{formatTime(t.at)}</span>
                    <span className={`status-dot ${t.to}`} />
                    <span>{STATUS_LABELS[t.to]}{t.from ? <span className="muted"> ← {STATUS_LABELS[t.from]}</span> : null}</span>
                  </div>
                ))}
              </div>
            )}
            <h4>Changed Files {changed ? `(${changed.length})` : ''}</h4>
            {!changed || changed.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>No changes</div>
            ) : (
              <div className="file-list">
                {changed.map((e) => (
                  <div key={e.path} className="f" onClick={() => openFileCard(e.path, s.cwd)} onDoubleClick={() => openViewerTab(e.path)} title={e.path}>
                    <span className={`git-letter ${e.gitStatus ?? ''}`} style={{ width: 12 }}>{e.gitStatus ?? '·'}</span>
                    <span className="ellipsis">{e.path.startsWith(s.cwd) ? e.path.slice(s.cwd.length).replace(/^[\\/]/, '') : basename(e.path)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => exportSession(s.id)}>Export</button>
              <button className="btn sm" onClick={() => void window.desktop.openPath(s.cwd)}>Explorer</button>
              <button className="btn sm" onClick={() => void window.desktop.openInVsCode(s.cwd)}>Open in VS Code</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const KIND_ICON: Record<InboxItem['kind'], string> = { waiting: '?', done: '✓', error: '!', directive: '→', report: '←' };

/** Reports meant for the user (report_up to the manager, completion of the user's order) — not session-to-session traffic. */
function forUser(it: InboxItem): boolean {
  if (it.kind === 'directive') return false;
  if (it.kind !== 'report') return true;
  return !it.text.includes(' → ') || it.text.includes('→ Manager (you)');
}

function Inbox(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(15000);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const items = inbox
    .filter(forUser)
    .filter((it) => matches(query, it.text, sessions.get(it.sessionId)?.title))
    .sort((a, b) => Number(a.read) - Number(b.read) || b.createdAt - a.createdAt);
  useHighlight(body, query, [items.length, inbox]);

  const open = (it: InboxItem): void => {
    if (selecting()) return; // the user is selecting text to copy
    if (!it.read) send({ type: 'inbox.read', id: it.id });
    if (sessions.has(it.sessionId)) selectAndReveal(it.sessionId);
  };

  return (
    <div className="rp-body" ref={body}>
      <SearchBox value={query} onChange={setQuery} count={items.length} placeholder="Search the inbox" />
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{query ? 'No matches.' : 'No notifications.'}</div>
      ) : (
        <div className="inbox-list">
          {items.map((it) => (
            <div key={it.id} className={`inbox-item ${it.read ? '' : 'unread'}`} onClick={() => open(it)}>
              <span className={`ic ${it.kind}`}>{KIND_ICON[it.kind]}</span>
              <div className="body">
                <div className="st">
                  {(() => {
                    const s = sessions.get(it.sessionId);
                    return s && s.projectId ? <span className="project-tag" style={pcStyle(projectColor(s.projectId, projects))} title={projectLabel(s.projectId, projects)}>{projectLabel(s.projectId, projects)}</span> : null;
                  })()}
                  <span className="ellipsis">{sessions.get(it.sessionId)?.title ?? '(deleted session)'}</span>
                  <span className="time" title={formatDateTime(it.createdAt)}>{relativeTime(it.createdAt, now)}</span>
                  <CopyButton text={it.text} title="Copy this notification" />
                </div>
                <div className={`tx ${query ? 'full' : ''}`} title={it.text}>{it.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.some((i) => !i.read) && (
        <button className="btn sm ghost" onClick={() => items.filter((i) => !i.read).forEach((i) => send({ type: 'inbox.read', id: i.id }))}>Mark All Read</button>
      )}
    </div>
  );
}

/**
 * The user (the manager) gives orders, one project at a time: a tab per open project (its order goes to the project's
 * head coach — or, without one, its lead), plus "＋ New" to start a project. Below: that project's routines and the
 * manager's orders to it. A part or a single session is talked to from its Session tab.
 */
function Orders(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const selectedId = useStore((s) => s.selectedId);
  const allRoutines = useStore((s) => s.routines);
  const now = useNow(15000);
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  const [tab, setTab] = useDraft<string>('orders.project', tops[0]?.id ?? 'new');
  // the order being written survives switching tabs (and restarts) until it is given
  const [text, setText] = useDraft('orders.text', '');
  // repeat: off = one order now; every = every N minutes; daily = every day at HH:MM
  const [repeat, setRepeat] = useDraft<'off' | 'every' | 'daily'>('orders.repeat', 'off');
  const [every, setEvery] = useDraft('orders.every', 10);
  const [at, setAt] = useDraft('orders.at', '09:00');
  const [newName, setNewName] = useDraft('orders.newName', '');
  const [newFolders, setNewFolders] = useDraft<string[]>('orders.newFolders', []);
  const [planFirst, setPlanFirst] = useDraft('orders.planFirst', true);
  /** a project just started from "＋ New": its tab opens once the daemon has created it */
  const [pendingName, setPendingName] = useState('');
  const files = useAttachments();

  // follow the selection: picking a session on the Ground or in the tree opens its project's tab
  const sel = selectedId ? sessions.get(selectedId) : undefined;
  const selProject = sel ? projects.find((p) => p.id === sel.projectId) : undefined;
  const selRoot = selProject?.parentId ?? selProject?.id;
  useEffect(() => {
    if (selRoot && tops.some((t) => t.id === selRoot)) setTab(selRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRoot]);
  useEffect(() => {
    if (!pendingName) return;
    const made = tops.find((t) => t.name === pendingName);
    if (made) {
      setTab(made.id);
      setPendingName('');
    }
  }, [pendingName, tops, setTab]);
  const current = tops.find((t) => t.id === tab);
  // a remembered tab whose project was closed or deleted: the first open project
  useEffect(() => {
    if (tab !== 'new' && !current && !pendingName) setTab(tops[0]?.id ?? 'new');
  }, [tab, current, tops, pendingName, setTab]);
  const isNew = !current;

  const tree = new Set(current ? [current.id, ...projects.filter((p) => p.parentId === current.id).map((p) => p.id)] : []);
  const members = [...sessions.values()].filter((s) => tree.has(s.projectId)).sort((a, b) => a.createdAt - b.createdAt);
  const head = members.find((s) => s.role === 'head');
  /** without a head coach the project's order goes to its parts' leads (coach, else first player) */
  const leads = head ? [] : members.filter((s) => s.role === 'coach');
  const taker = head ?? leads[0] ?? members.find((s) => s.role === 'player');
  const routines = allRoutines.filter((r) => {
    const t = r.target;
    if (t.kind === 'project') return tree.has(t.projectId);
    if (t.kind === 'session') return members.some((s) => s.id === t.sessionId);
    return false;
  });

  const canSubmit = text.trim() !== '' && !files.busy && (isNew ? newName.trim() !== '' && newFolders.length > 0 : !!taker);
  const submit = (): void => {
    if (!canSubmit) return;
    const body = withAttachments(text.trim(), files.items);
    if (isNew) {
      send({ type: 'project.start', name: newName.trim(), folders: newFolders, text: body, plan: planFirst });
      setPendingName(newName.trim());
      setNewName('');
      setNewFolders([]);
    } else if (repeat === 'off') send({ type: 'team.order', target: { kind: 'project', projectId: current.id }, text: body });
    else
      send({
        type: 'routine.save',
        routine: {
          name: text.trim().split('\n')[0]!.slice(0, 40),
          target: { kind: 'project', projectId: current.id },
          text: body,
          enabled: true,
          runNow: true,
          ...(repeat === 'every' ? { everyMinutes: Math.max(1, every) } : { dailyAt: at })
        }
      });
    setText('');
    files.clear();
  };

  return (
    <div className="rp-body">
      {/* the same card as Tasks › New task: project chips, the order, attachments and the send row */}
      <div className="new-task orders-card">
      <div className="new-task-to" role="tablist">
        {tops.map((p) => (
          <button key={p.id} role="tab" className={`project-tag ${tab === p.id ? 'on' : ''}`} style={pcStyle(projectColor(p.id, projects))} onClick={() => setTab(p.id)} title={p.name}>
            {p.name}
          </button>
        ))}
        <button role="tab" className={`project-tag new ${isNew ? 'on' : ''}`} onClick={() => setTab('new')} title="Start a new project: AgentO sets up the project and its head coach">
          ＋ New project
        </button>
      </div>
      <div className="orders-form">
        {isNew ? (
          <div className="new-project">
            <input value={newName} placeholder="Project name" onChange={(e) => setNewName(e.target.value)} />
            <div className="new-folders">
              {newFolders.map((f) => (
                <span key={f} className="new-folder" title={f}>
                  <span className="ellipsis">{f}</span>
                  <button className="attach-x static" onClick={() => setNewFolders(newFolders.filter((x) => x !== f))} title="Remove">×</button>
                </span>
              ))}
              <button
                className="btn sm"
                onClick={() =>
                  void window.desktop.pickFolder().then((d) => {
                    if (d && !newFolders.includes(d)) setNewFolders([...newFolders, d]);
                  })
                }
              >
                + Folder
              </button>
            </div>
            <label className="new-plan" title="On: the head coach reports its team and plan, and waits for your go. Off: it starts the work right away.">
              <input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} />
              Report the plan first and wait for my go
            </label>
          </div>
        ) : (
          <div className="order-to">
            <span className="muted">To</span>
            {taker ? (
              <span className={`team-chip ${taker.role}`}>{taker.title}</span>
            ) : (
              <span className="muted">no sessions yet</span>
            )}
            {!head && leads.length > 1 && <span className="muted">and {leads.length - 1} other coach{leads.length > 2 ? 'es' : ''}</span>}
            <span className="grow" />
            {!head && (
              <button className="btn sm ghost" onClick={() => send({ type: 'head.create', projectId: current.id })} title="Add the project's head coach: it splits your orders among the parts">
                + Head Coach
              </button>
            )}
          </div>
        )}
        <textarea
          value={text}
          placeholder={
            isNew
              ? 'Brief for the new project: what to build, how to proceed. The head coach designs the team. Paste or drop images.'
              : 'Your order. The team splits the work, and you get a report here when it is done. Paste or drop images.'
          }
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const imgs = imageFiles(e.clipboardData);
            if (imgs.length) {
              e.preventDefault();
              files.add(imgs);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const imgs = imageFiles(e.dataTransfer);
            if (imgs.length) {
              e.preventDefault();
              files.add(imgs);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <AttachmentBar items={files.items} onRemove={files.remove} />
        <div className="row orders-repeat">
          <AttachButton onFiles={files.add} />
          {!isNew && (
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} title="Repeat this order on a schedule">
              <option value="off">Once</option>
              <option value="every">Every … min</option>
              <option value="daily">Daily at …</option>
            </select>
          )}
          {!isNew && repeat === 'every' && <input type="number" min={1} value={every} onChange={(e) => setEvery(Number(e.target.value) || 1)} />}
          {!isNew && repeat === 'daily' && <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />}
          <span className="grow" />
          <span className="orders-hint">Ctrl+Enter</span>
          <button className="btn sm primary" disabled={!canSubmit} onClick={submit}>
            {isNew ? 'Start Project' : repeat === 'off' ? 'Give Order' : 'Create Routine'}
          </button>
        </div>
      </div>
      </div>
      {!isNew && routines.length > 0 && (
        <div className="rp-section">
          <h4>Routines</h4>
          <div className="routine-list">
            {routines.map((r) => (
              <RoutineRow key={r.id} r={r} now={now} />
            ))}
          </div>
        </div>
      )}
      {!isNew && <MyOrders projectIds={tree} />}
    </div>
  );
}

/** One repeating order: schedule, next run, run count; run now / pause / delete. */
function RoutineRow({ r, now }: { r: Routine; now: number }): JSX.Element {
  const schedule = r.dailyAt ? `daily ${r.dailyAt}` : `every ${r.everyMinutes} min`;
  const next = r.enabled ? (r.nextAt <= now ? 'due' : `in ${Math.max(1, Math.round((r.nextAt - now) / 60000))} min`) : 'paused';
  return (
    <div className={`routine ${r.enabled ? '' : 'off'}`}>
      <div className="routine-head">
        <span className="ellipsis" title={r.text}>{r.name}</span>
        <span className="muted">{schedule} · #{r.runs} · next {next}</span>
      </div>
      <div className="row">
        <button className="btn sm ghost" onClick={() => send({ type: 'routine.run', id: r.id })}>Run Now</button>
        <button
          className="btn sm ghost"
          onClick={() => send({ type: 'routine.save', routine: { id: r.id, name: r.name, target: r.target, text: r.text, enabled: !r.enabled, ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes ?? 60 }) } })}
        >
          {r.enabled ? 'Pause' : 'Resume'}
        </button>
        <button className="btn sm ghost danger" onClick={() => { if (window.confirm(`Delete routine "${r.name}"?`)) send({ type: 'routine.delete', id: r.id }); }}>Delete</button>
      </div>
    </div>
  );
}

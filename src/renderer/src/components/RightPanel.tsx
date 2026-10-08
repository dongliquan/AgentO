import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem, Routine, Session, TeamOrderTarget } from '@shared/protocol';
import { unreadCount, useStore, type RightTab } from '@/store';
import { requestChanged, send } from '@/client';
import { exportSession, focusTerminal, removeSession, selectAndReveal } from '@/commands';
import { AGENT_LABELS, STATUS_LABELS, projectLabel, roleLabel, displayTitle, basename, formatDateTime, formatTime, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { openFile } from '@/lib/openfile';
import { StatusBadge } from './StatusBadge';
import { AgentIcon } from './AgentIcon';
import { ChatView, Composer } from './ChatView';
import { screenLines } from '@/lib/screen';
import { TeamLog } from './TeamLog';
import { WebPanel } from './WebPanel';
import { TAB_ORDER, useDock } from '@/lib/dock';
import { ShareSplitter } from './Splitter';
import { TaskList } from './TaskList';
import { useOpenInbox as useTaskInbox, threadsOf } from '@/lib/closed';
import { isTask, orderStatus, pieceResult } from '@/lib/threads';
import { orderProgress } from '@/lib/progress';
import { lastLines } from '@/lib/ansi';
import { matches, selecting, useHighlight } from '@/lib/search';
import { useOpenInbox } from '@/lib/closed';
import { CopyButton, SearchBox } from './SearchBox';
import { useDraft } from '@/lib/draft';
import { ProjectFilter, useProjectFilter } from './ProjectFilter';
import { MyTalk } from './MyTalk';
import { useTalkProject } from '@/lib/talkFilter';
import { ContextSize, freshStart, restoreEarlier } from './ContextSize';
import { pcStyle, projectColor } from '@/lib/format';
import { imageFiles, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachButton, AttachmentBar } from './AttachmentBar';
import { kbd } from '@/lib/keys';
import { useBuffer } from '@/lib/buffers';

const TAB_LABEL: Record<RightTab, string> = { orders: 'Manager', tasks: 'Tasks', inbox: 'Inbox', detail: 'Session', log: 'Logs', web: 'Web' };
const TAB_TITLE: Partial<Record<RightTab, string>> = {
  orders: 'You, the manager: what you said and the answers, and the order box (projects, new project, routines)',
  tasks: 'Your orders: what is open, reported, done',
  log: 'Everything the team sent each other, by order',
  web: 'Gemini, ChatGPT, ERNIE on the web — your own sign-in and subscription'
};

/** Badge counts for the tab strip and the docked columns: reports to review (Tasks), unread (Inbox). */
function useTabCounts(): Partial<Record<RightTab, number>> {
  const unread = useStore(unreadCount);
  const taskInbox = useTaskInbox();
  const sessionsAll = useStore((s) => s.sessions);
  const doneOrders = useStore((s) => s.doneOrders);
  const taskOrders = useStore((s) => s.taskOrders);
  const toReview = useMemo(() => {
    const explicit = new Set(taskOrders);
    return threadsOf(taskInbox).filter((t) => isTask(t, sessionsAll, explicit) && !doneOrders[t.item.id] && orderStatus(t, sessionsAll) === 'reported').length;
  }, [taskInbox, sessionsAll, doneOrders, taskOrders]);
  return { tasks: toReview, inbox: unread };
}

/** A tab's content (the Web tab is handled apart: its pages stay mounted). */
function TabContent({ tab, session }: { tab: RightTab; session: Session | undefined }): JSX.Element | null {
  if (tab === 'detail') return session ? <Detail session={session} /> : <div className="rp-body muted dock-empty">Select a session on the Ground or in the tree.</div>;
  if (tab === 'orders') return <ManagerTab />;
  if (tab === 'tasks') return <TaskList />;
  if (tab === 'log') return <TeamLog />;
  if (tab === 'inbox') return <Inbox />;
  return null;
}

export function RightPanel(): JSX.Element {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const session = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId) : undefined));
  const docked = useDock((s) => s.docked);
  const dock = useDock((s) => s.dock);
  const here = TAB_ORDER.filter((t) => !docked.includes(t));
  // the chosen tab, unless it is docked (or Session without a session): then the first tab still in the panel
  const want = rightTab === 'detail' && !session ? 'orders' : rightTab;
  const tab = here.includes(want) ? want : here.find((t) => t !== 'detail' || session) ?? here[0]!;
  // the Web tab mounts once it is first opened, then stays (hidden) so its pages never reload
  const [webMounted, setWebMounted] = useState(tab === 'web');
  useEffect(() => {
    if (tab === 'web') setWebMounted(true);
  }, [tab]);
  const counts = useTabCounts();

  return (
    <div className="rightpanel">
      <div className="rp-tabs">
        {here.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setRightTab(t)} disabled={t === 'detail' && !session} title={TAB_TITLE[t]}>
            {TAB_LABEL[t]}
            {(counts[t] ?? 0) > 0 && <span className="badge inline">{counts[t]}</span>}
          </button>
        ))}
        {here.length > 1 && (
          <button className="rp-dock" title={`To the second panel: ${TAB_LABEL[tab]}`} onClick={() => dock(tab)}>
            ⇥
          </button>
        )}
      </div>
      {tab === 'web' ? null : <TabContent tab={tab} session={session} />}
      {webMounted && !docked.includes('web') && <WebPanel visible={tab === 'web'} />}
    </div>
  );
}

/**
 * The second panel beside the main one (main : second = 2 : 1): the tabs sent here with ⇥, as tabs of their own;
 * ⇤ sends the shown one back. It is not there while it holds no tab. Main window: half the main panel's share of the
 * window (dragged, remembered); panels window: a third of the width.
 */
export function SecondPanel({ panels = false }: { panels?: boolean }): JSX.Element | null {
  const docked = useDock((s) => s.docked);
  const undock = useDock((s) => s.undock);
  const shownTab = useDock((s) => s.shown);
  const setShown = useDock((s) => s.setShown);
  const session = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId) : undefined));
  const counts = useTabCounts();
  const tab = shownTab && docked.includes(shownTab) ? shownTab : docked[0];
  if (!tab) return null;
  return (
    <>
      {panels ? <div className="splitter dock-gap" /> : <ShareSplitter cssVar="--second-share" dir={-1} fallback={18} min={12} max={40} />}
      <div className={`rightpanel second ${panels ? 'in-panels' : ''}`}>
        <div className="rp-tabs">
          {docked.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setShown(t)} title={TAB_TITLE[t]}>
              {TAB_LABEL[t]}
              {(counts[t] ?? 0) > 0 && <span className="badge inline">{counts[t]}</span>}
            </button>
          ))}
          <button className="rp-dock" title={`Back into the main panel: ${TAB_LABEL[tab]}`} onClick={() => undock(tab)}>
            ⇤
          </button>
        </div>
        {tab === 'web' ? null : <TabContent tab={tab} session={session} />}
        {/* the Web pages stay mounted while another tab is shown here, so they never reload */}
        {docked.includes('web') && <WebPanel visible={tab === 'web'} />}
      </div>
    </>
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
  // Claude, and Codex once its conversation is found, show as a chat; other CLIs as their terminal screen
  const hasChat = s.agent === 'claude' || (s.agent === 'codex' && !!s.resumeId);
  const buffer = useBuffer(s.id, !hasChat) ?? '';
  const project = projects.find((p) => p.id === s.projectId);
  const folder = project?.folders.find((f) => f.id === s.folderId);
  const entries = timeline.filter((t) => t.sessionId === s.id).slice(-20).reverse();
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number | undefined>(undefined);
  const termRef = useRef<HTMLPreElement>(null);
  // a terminal agent (Codex …) draws with cursor moves: show its screen as the terminal does (replayed off-screen)
  const [screen, setScreen] = useState<string[]>([]);
  useEffect(() => {
    if (hasChat) return;
    let live = true;
    const t = setTimeout(() => {
      void screenLines(buffer.slice(-200_000), s.cols || 100, Math.max(s.rows || 30, 60)).then((lines) => {
        if (live) setScreen(lines.map((l) => l.replace(/\s+$/, '')));
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [buffer, s.agent, s.cols, s.rows]);
  const shown = screen.length ? screen : lastLines(buffer, 200);
  const termLines = hasChat ? [] : shown.filter((l, i, all) => matches(query, l) && (l.trim() || (i > 0 && all[i - 1]!.trim())));
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
          <StatusBadge status={s.status} attention={s.attention} />
        </div>
        <div className="rp-meta">
          {s.role !== 'player' && <span className={`role-tag ${s.role}`}>{roleLabel(s)}</span>}
          <span>{projectLabel(s.projectId, projects)}</span>
          <span className="muted">· {AGENT_LABELS[s.agent]}</span>
          <span className="grow" />
          <button className="btn sm ghost" onClick={openTerminal}>Terminal</button>
          <ContextSize session={s} />
          {s.agent === 'claude' && !!s.prevResumeIds?.length && (
            <button className="btn sm ghost" onClick={() => restoreEarlier(s)} title="Resume the conversation from before the last fresh start / restart">Earlier Conversation</button>
          )}
          {s.agent === 'claude' && s.resumeId && (
            <button className="btn sm ghost" onClick={() => freshStart(s)} title="Write a handoff note, then continue in a new, small conversation (saves tokens)">Fresh Start</button>
          )}
          <button className="btn sm ghost" onClick={() => send({ type: 'session.restart', id: s.id })}>Restart</button>
          {s.status === 'hibernated' ? (
            <button className="btn sm ghost" onClick={() => send({ type: 'session.resume', id: s.id })}>Resume</button>
          ) : (
            <button className="btn sm ghost" disabled={!live} onClick={() => send({ type: 'session.stop', id: s.id })}>Stop</button>
          )}
          <button className="btn sm ghost danger" onClick={() => removeSession(s.id)} title="Remove Session (Delete)">Remove</button>
        </div>
      </div>
      <SearchBox value={query} onChange={setQuery} count={hasChat ? hits : termLines.length} placeholder="Search this conversation" />
      <div className="rp-conversation">
        {hasChat ? (
          <ChatView session={s} onShowTerminal={openTerminal} query={query} onMatches={setHits} />
        ) : (
          <div className="rp-term">
            <pre className="rp-term-preview" ref={termRef}>{termLines.join('\n') || (query ? 'No matches' : 'No output')}</pre>
            <Composer session={s} />
          </div>
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
                  <div key={e.path} className="f" onClick={() => openFile(e.path, s.cwd)} title={e.path}>
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
  // a piece of work came back to a coach / head coach: work news for the manager too
  if (pieceResult(it)) return true;
  return !it.text.includes(' → ') || it.text.includes('→ Manager (you)');
}

function Inbox(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(15000);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useDraft('inbox.project', '');
  const { only, rootOf } = useProjectFilter(pick);
  const body = useRef<HTMLDivElement>(null);
  const items = inbox
    .filter(forUser)
    .filter((it) => !only || rootOf(it.sessionId) === only)
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
      <div className="filter-bar">
        <ProjectFilter value={pick} onChange={setPick} />
        <SearchBox value={query} onChange={setQuery} count={items.length} placeholder="Search the inbox" />
      </div>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{query ? 'No matches.' : only ? 'No notifications for this project.' : 'No notifications.'}</div>
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
/**
 * The manager's tab: the conversation with the team (what you said, on the right, and the answers) filling the panel,
 * the order box at the bottom — like a messenger.
 */
function ManagerTab(): JSX.Element {
  return (
    <div className="manager-tab">
      <MyTalk />
      <Orders />
    </div>
  );
}

function Orders(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const selectedId = useStore((s) => s.selectedId);
  const allRoutines = useStore((s) => s.routines);
  const doneOrders = useStore((s) => s.doneOrders);
  const inboxAll = useOpenInbox();
  const now = useNow(15000);
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  /**
   * Per project: open work (orders not marked done and not fully reported) as pieces done / total, and the state now —
   * error (a session failed) · working (someone is on it) · waiting (open work but nobody running: it needs an answer or a nudge)
   */
  const progressOf = useMemo(() => {
    const m = new Map<string, { done: number; total: number; working: boolean; state: 'working' | 'waiting' | 'error' | null }>();
    const rootOf = (sessionId: string): string | undefined => {
      const s = sessions.get(sessionId);
      const p = s ? projects.find((x) => x.id === s.projectId) : undefined;
      return p?.parentId ?? p?.id;
    };
    for (const t of threadsOf(inboxAll)) {
      if (t.item.fromId !== 'user' || doneOrders[t.item.id]) continue;
      const root = rootOf(t.item.sessionId);
      if (!root) continue;
      const pr = orderProgress(t, sessions);
      if (pr.total === 0 || pr.done === pr.total) continue;
      const cur = m.get(root) ?? { done: 0, total: 0, working: false, state: null };
      cur.done += pr.done;
      cur.total += pr.total;
      cur.working ||= pr.working > 0;
      m.set(root, cur);
    }
    for (const [root, cur] of m) {
      const own = new Set([root, ...projects.filter((p) => p.parentId === root).map((p) => p.id)]);
      const members = [...sessions.values()].filter((s) => own.has(s.projectId));
      cur.state = members.some((s) => s.status === 'error')
        ? 'error'
        : members.some((s) => s.status === 'working' || s.status === 'starting')
          ? 'working'
          : 'waiting';
    }
    return m;
  }, [inboxAll, sessions, projects, doneOrders]);
  // 'new' = start a project · 'order' = give an order to the picked projects (one or several — they get the same order)
  // 'team' = not tied to a project: the team's head coach routes it (to a project's head coach, or starts a new project)
  const [tab, setTab] = useDraft<'new' | 'order' | 'team'>('orders.mode', tops.length ? 'order' : 'new');
  const [picked, setPicked] = useDraft<string[]>('orders.projects', tops[0] ? [tops[0].id] : []);
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
    if (tab !== 'team' && selRoot && tops.some((t) => t.id === selRoot) && picked.length <= 1 && picked[0] !== selRoot) {
      setPicked([selRoot]);
      setTab('order');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRoot]);
  useEffect(() => {
    if (!pendingName) return;
    const made = tops.find((t) => t.name === pendingName);
    if (made) {
      setPicked([made.id]);
      setTab('order');
      setPendingName('');
    }
  }, [pendingName, tops, setTab, setPicked]);
  /** projects whose head coach is working right now (one pass over the sessions, not one per chip) */
  const busyHeads = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions.values()) if (s.role === 'head' && (s.status === 'working' || s.status === 'starting')) ids.add(s.projectId);
    return ids;
  }, [sessions]);
  /** the picked projects that still exist and are open (a closed or deleted one drops out) */
  const currents = tops.filter((t) => picked.includes(t.id));
  useEffect(() => {
    if (currents.length !== picked.length) setPicked(currents.map((t) => t.id));
    if (tab === 'order' && currents.length === 0 && !pendingName) {
      if (tops[0]) setPicked([tops[0].id]);
      else setTab('new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currents.length, picked.length, tops.length, pendingName]);
  const isTeam = tab === 'team';
  // the conversation above follows the order box: one project picked → only its messages; several, Team or New → all
  const setTalkProject = useTalkProject((s) => s.setProject);
  const followKey = tab === 'order' && picked.length === 1 ? picked[0]! : '';
  useEffect(() => {
    setTalkProject(followKey);
  }, [followKey, setTalkProject]);
  const isNew = tab === 'new' || (!isTeam && currents.length === 0);
  /** the team-wide head coach (no project): takes the orders given without a project; made with the first such order */
  const teamHead = [...sessions.values()].find((s) => s.role === 'head' && !s.projectId);
  const allPicked = tops.length > 1 && currents.length === tops.length;
  /** click: toggle (the last one stays); the All chip picks every open project */
  const toggle = (id: string): void => {
    setTab('order');
    if (picked.includes(id)) {
      if (picked.length > 1) setPicked(picked.filter((x) => x !== id));
    } else setPicked([...picked, id]);
  };

  const scope = isTeam ? tops : currents;
  const tree = new Set(scope.flatMap((c) => [c.id, ...projects.filter((p) => p.parentId === c.id).map((p) => p.id)]));
  if (isTeam) tree.add(''); // the team head coach's own orders
  const members = [...sessions.values()].filter((s) => tree.has(s.projectId)).sort((a, b) => a.createdAt - b.createdAt);
  /** who takes the order in each picked project: its head coach, else its parts' leads (coach, else first player) */
  const takers = currents.map((c) => {
    const own = new Set([c.id, ...projects.filter((p) => p.parentId === c.id).map((p) => p.id)]);
    const ms = members.filter((s) => own.has(s.projectId));
    const head = ms.find((s) => s.role === 'head');
    const leads = head ? [] : ms.filter((s) => s.role === 'coach');
    return { project: c, head, leads, taker: head ?? leads[0] ?? ms.find((s) => s.role === 'player') };
  });
  const missing = takers.filter((t) => !t.taker);
  const routines = allRoutines.filter((r) => {
    const t = r.target;
    if (t.kind === 'all') return isTeam;
    if (t.kind === 'project') return tree.has(t.projectId);
    if (t.kind === 'projects') return t.projectIds.some((id) => tree.has(id));
    if (t.kind === 'session') return members.some((s) => s.id === t.sessionId);
    return false;
  });
  /** one project: a plain project order (as before); several: the same order to each, told about the others */
  const target = (): TeamOrderTarget =>
    isTeam ? { kind: 'all' } : currents.length === 1 ? { kind: 'project', projectId: currents[0]!.id } : { kind: 'projects', projectIds: currents.map((c) => c.id) };

  // a new project without a folder gets one (~/AgentO Projects/<name>)
  const canSubmit = text.trim() !== '' && !files.busy && (isNew ? newName.trim() !== '' : isTeam ? true : currents.length > 0 && missing.length === 0);
  const submit = (): void => {
    if (!canSubmit) return;
    const body = withAttachments(text.trim(), files.items);
    if (isNew) {
      send({ type: 'project.start', name: newName.trim(), folders: newFolders, text: body, plan: planFirst });
      setPendingName(newName.trim());
      setNewName('');
      setNewFolders([]);
    } else {
      // a team order needs the team head coach: created now, the order reaches it once it is up
      if (isTeam && !teamHead) send({ type: 'head.create', projectId: '' });
      if (repeat === 'off') send({ type: 'team.order', target: target(), text: body });
      else
        send({
        type: 'routine.save',
        routine: {
          name: text.trim().split('\n')[0]!.slice(0, 40),
          target: target(),
          text: body,
          enabled: true,
          runNow: true,
          ...(repeat === 'every' ? { everyMinutes: Math.max(1, every) } : { dailyAt: at })
        }
      });
    }
    setText('');
    files.clear();
  };

  return (
    <div className="rp-body manager-compose">
      {/* the same card as Tasks › New task: project chips, the order, attachments and the send row */}
      <div className="new-task orders-card">
      <div className="new-task-to" role="tablist">
        <button role="tab" className={`project-tag all ${isTeam ? 'on' : ''}`} onClick={() => setTab('team')} title="Not tied to a project: the team's head coach decides which project it is for, or starts a new one">
          Team
        </button>
        <span className="chip-sep" aria-hidden="true" />
        {tops.length > 1 && (
          <button role="tab" className={`project-tag all ${!isNew && !isTeam && allPicked ? 'on' : ''}`} onClick={() => { setTab('order'); setPicked(tops.map((t) => t.id)); }} title="The same order to every open project">
            All
          </button>
        )}
        {tops.map((p) => {
          const pr = progressOf.get(p.id);
          // "in progress" = the project's head coach is working right now (players working alone do not count)
          const headBusy = busyHeads.has(p.id);
          const pct = pr ? Math.round((pr.done / pr.total) * 100) : 0;
          const stateText = pr?.state === 'working' ? 'working now' : pr?.state === 'waiting' ? 'waiting — nobody is running; it may need an answer or a nudge' : pr?.state === 'error' ? 'a session failed' : '';
          const info = `${pr ? ` — ${pr.done}/${pr.total} pieces done · ${stateText}` : ''}${headBusy ? ' · head coach working' : ''}`;
          return (
            <button
              key={p.id}
              role="tab"
              className={`project-tag ${!isNew && !isTeam && picked.includes(p.id) ? 'on' : ''} ${pr ? 'prog' : ''}`}
              style={{ ...pcStyle(projectColor(p.id, projects)), '--pct': `${pct}%` } as React.CSSProperties}
              onClick={() => toggle(p.id)}
              title={`${p.name}${info} — click to add or remove it from the order`}
            >
              {headBusy && <span className="status-dot working" />}
              <span className="ellipsis">{p.name}</span>
            </button>
          );
        })}
        {tops.length > 0 && <span className="chip-sep" aria-hidden="true" />}
        <button role="tab" className={`project-tag new ${isNew ? 'on' : ''}`} onClick={() => setTab('new')} title="New project: AgentO sets up the project and its head coach">
          ＋
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
              {newFolders.length === 0 && (
                <span className="muted new-folder-hint">No folder: a new one is made — AgentO Projects\{newName.trim() || '<name>'}</span>
              )}
            </div>
            <label className="new-plan" title="On: the head coach reports its team and plan, and waits for your go. Off: it starts the work right away.">
              <input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} />
              Report the plan first and wait for my go
            </label>
          </div>
        ) : isTeam ? (
          <div className="order-to">
            <span className="muted">To</span>
            {teamHead ? (
              <span className="team-chip head" title="Routes the order to the right project's head coach, or starts a new project">{teamHead.title}</span>
            ) : (
              <span className="muted" title="Routes the order to the right project's head coach, or starts a new project">Head Coach (team) — created with your first order</span>
            )}
            <span className="grow" />
          </div>
        ) : (
          <div className="order-to">
            <span className="muted">To</span>
            {takers.map(({ project, taker, head, leads }) =>
              taker ? (
                <span key={project.id} className={`team-chip ${taker.role}`} title={currents.length > 1 ? `${project.name}: ${taker.title}${!head && leads.length > 1 ? ` and ${leads.length - 1} other coach(es)` : ''}` : undefined}>
                  {taker.title}
                  {!head && leads.length > 1 && <span className="muted"> +{leads.length - 1}</span>}
                </span>
              ) : (
                <span key={project.id} className="muted">
                  {currents.length > 1 ? `${project.name}: ` : ''}no sessions yet
                </span>
              )
            )}
            <span className="grow" />
            {takers.filter((t) => !t.head).map(({ project }) => (
              <button key={project.id} className="btn sm ghost" onClick={() => send({ type: 'head.create', projectId: project.id })} title={`Add ${project.name}'s head coach: it splits your orders among the parts`}>
                + Head Coach{currents.length > 1 ? ` · ${project.name}` : ''}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={text}
          placeholder={
            isNew
              ? 'Brief for the new project: what to build, how to proceed. The head coach designs the team. Paste or drop images.'
              : isTeam
                ? 'Any order, no project needed: the team head coach works out which project it belongs to — or starts a new one — and reports back here. Paste or drop images.'
                : currents.length > 1
                ? `Your order to ${currents.length} projects at once: each team handles its own side, and you get a report from each. Paste or drop images.`
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
          <span className="orders-hint">{kbd('Ctrl+Enter')}</span>
          <button className="btn sm primary" disabled={!canSubmit} onClick={submit}>
            {isNew ? 'Start Project' : repeat === 'off' ? (currents.length > 1 ? `Give Order · ${currents.length} projects` : 'Give Order') : 'Create Routine'}
          </button>
        </div>
      </div>
      </div>
      {!isNew && routines.length > 0 && (
        <details className="rp-section manager-routines">
          <summary>
            Routines <span className="muted">{routines.length}</span>
          </summary>
          <div className="routine-list">
            {routines.map((r) => (
              <RoutineRow key={r.id} r={r} now={now} />
            ))}
          </div>
        </details>
      )}
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

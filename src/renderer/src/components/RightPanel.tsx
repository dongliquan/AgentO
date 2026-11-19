import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { unreadCount, useStore, type RightTab } from '@/store';
import { requestChanged, send } from '@/client';
import { exportSession } from '@/commands';
import { AGENT_LABELS, STATUS_LABELS, projectLabel, displayTitle, basename, formatDateTime, formatTime, relativeTime } from '@/lib/format';
import { ModelChip } from './ModelChip';
import { inboxHtml, inboxViewOf } from '@/lib/inboxText';
import { openNeed, useNeedsIds } from './NeedsYou';
import { RECENT_MS, RecentToggle, useRecentOnly } from './RecentToggle';
import { useNow } from '@/lib/hooks';
import { openFile } from '@/lib/openfile';
import { StatusBadge } from './StatusBadge';
import { AgentIcon } from './AgentIcon';
import { ChatView, Composer } from './ChatView';
import { TerminalView } from './TerminalView';
import { screenLines } from '@/lib/screen';
import { FilesPanel } from './FilesPanel';
import { WebPanel } from './WebPanel';
import { TAB_ORDER, useDock } from '@/lib/dock';
import { ShareSplitter } from './Splitter';
import { lastLines } from '@/lib/ansi';
import { matches, selecting, useHighlight } from '@/lib/search';
import { useOpenInbox } from '@/lib/closed';
import { CopyButton, SearchBox } from './SearchBox';
import { ProjectFilter, useProjectFilter } from './ProjectFilter';
import { useTalkProject } from '@/lib/talkFilter';
import { ContextSize } from './ContextSize';
import { pcStyle, projectColor } from '@/lib/format';
import { useBuffer } from '@/lib/buffers';

const TAB_LABEL: Record<RightTab, string> = { inbox: 'Inbox', detail: 'Session', files: 'Files', web: 'Web' };
const TAB_TITLE: Partial<Record<RightTab, string>> = {
  files: 'Files — the selected session\'s project folders; a file name clicked in a chat is shown here',
  inbox: 'Inbox — what happened in your sessions (finished, waiting, errors)',
  web: 'Gemini, ChatGPT on the web — your own sign-in and subscription'
};

/** Badge counts for the tab strip and the docked columns: unread (Inbox). */
function useTabCounts(): Partial<Record<RightTab, number>> {
  const unread = useStore(unreadCount);
  return { inbox: unread };
}

/** A tab's content (the Web tab is handled apart: its pages stay mounted). */
function TabContent({ tab, session }: { tab: RightTab; session: Session | undefined }): JSX.Element | null {
  if (tab === 'detail') return session ? <Detail session={session} /> : <div className="rp-body muted dock-empty">Select a session on the Ground or in the tree.</div>;
  if (tab === 'inbox') return <Inbox />;
  if (tab === 'files') return <FilesPanel />;
  return null;
}

/**
 * The project filter (Manager order box · Inbox · Logs) follows the selected session's project from any view — a tab in
 * Tabs, a card, a tree row — even while the Manager tab is not shown or the panel is closed (mounted by App). Like the order box itself: only while one project
 * (or none) is picked there (a multi-project pick is kept); Team / New mode goes back to that project's orders.
 */
export function useFollowSelection(): void {
  const selectedId = useStore((s) => s.selectedId);
  const setTalkProject = useTalkProject((s) => s.setProject);
  useEffect(() => {
    const st = useStore.getState();
    const sel = selectedId ? st.sessions.get(selectedId) : undefined;
    const p = sel ? st.projects.find((x) => x.id === sel.projectId) : undefined;
    if (!p || p.closed) return;
    setTalkProject(p.id);
  }, [selectedId, setTalkProject]);
}

export function RightPanel(): JSX.Element {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const session = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId) : undefined));
  const docked = useDock((s) => s.docked);
  const dock = useDock((s) => s.dock);
  const here = TAB_ORDER.filter((t) => !docked.includes(t));
  // the chosen tab, unless it is docked (or Session without a session): then the first tab still in the panel
  const want = rightTab === 'detail' && !session ? 'files' : rightTab;
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

  // the Terminal button switches this panel's own view (chat ⇄ terminal); the Ground card keeps what it shows
  // it opens on the terminal (a headless session shows its activity log there) whenever the session has a conversation
  const startOnTerminal = hasChat;
  const [termMode, setTermMode] = useState(startOnTerminal);
  // the search field is folded away (the header stays two lines): the ⌕ button next to the status opens it
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => setSearchOpen(false), [s.id]);
  useEffect(() => setTermMode(startOnTerminal), [s.id]);
  // (no focusTerminal here: the Ground card listens to that event and would switch to its terminal too)
  const openTerminal = (): void => setTermMode(true);

  return (
    <>
      <div className="rp-detail-head">
        <div className="rp-title">
          <AgentIcon kind={s.agent} color={s.color} size={16} />
          <span className="ellipsis" style={{ flex: 1 }} title={s.title}>{displayTitle(s)}</span>
          <StatusBadge status={s.status} attention={s.attention} />
          {!termMode && (
            <button
              className={`icon-btn ${searchOpen || query ? 'on' : ''}`}
              title="Search this conversation"
              onClick={() => {
                if (searchOpen || query) {
                  setSearchOpen(false);
                  setQuery('');
                } else setSearchOpen(true);
              }}
            >
              ⌕
            </button>
          )}
        </div>
        <div className="rp-meta">
          <span>{projectLabel(s.projectId, projects)}</span>
          <span className="muted">· {AGENT_LABELS[s.agent]}</span>
          <span className="grow" />
          <button
            className="btn sm ghost"
            onClick={() => (termMode ? setTermMode(false) : openTerminal())}
            title={termMode ? 'Back to the conversation' : s.mode === 'headless' ? 'The terminal view — a headless session has no screen, so this is its activity log' : 'The terminal screen — type into it (answers, /mcp …)'}
          >
            {termMode ? (hasChat ? 'Chat' : 'Summary') : 'Terminal'}
          </button>
          <ModelChip session={s} />
          <ContextSize session={s} />
        </div>
      </div>
      {/* it searches the chat (or the summary): in the live terminal view there is nothing for it to search */}
      {!termMode && (searchOpen || query) && <SearchBox value={query} onChange={setQuery} count={hasChat ? hits : termLines.length} placeholder="Search this conversation" autoFocus onClose={() => setSearchOpen(false)} />}
      <div className="rp-conversation">
        {termMode ? (
          <div className="rp-term-live">
            <TerminalView sessionId={s.id} autoFocus />
          </div>
        ) : hasChat ? (
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
  return !it.text.includes(' → ') || it.text.includes('→ Manager (you)');
}

function Inbox(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(15000);
  const [query, setQuery] = useState('');
  // the project filter is shared with the Manager tab and the Logs
  const pick = useTalkProject((s) => s.project);
  const setPick = useTalkProject((s) => s.setProject);
  const { only, rootOf } = useProjectFilter(pick);
  const body = useRef<HTMLDivElement>(null);
  // what waits for the manager's decision is pinned on top and marked
  const needs = useNeedsIds((st) => st.list);
  const needItems = useMemo(() => new Set(needs.flatMap((n) => (n.itemId ? [n.itemId] : []))), [needs]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [recentOnly, setRecentOnly] = useRecentOnly();
  const cutoff = Date.now() - RECENT_MS;
  const scoped = inbox.filter(forUser).filter((it) => !only || rootOf(it.sessionId) === only);
  const older = recentOnly ? scoped.filter((it) => it.createdAt < cutoff).length : 0;
  const items = scoped
    .filter((it) => !recentOnly || it.createdAt >= cutoff)
    .filter((it) => matches(query, it.text, sessions.get(it.sessionId)?.title))
    // newest first, read or not (what waits for the manager is marked, not moved)
    .sort((a, b) => b.createdAt - a.createdAt);
  useHighlight(body, query, [items.length, inbox]);

  // a click reads the whole notification in place (and marks it read); Open goes to the session's conversation
  const toggle = (it: InboxItem): void => {
    if (selecting()) return; // the user is selecting text to copy
    if (!it.read) send({ type: 'inbox.read', id: it.id });
    const next = new Set(expanded);
    if (next.has(it.id)) next.delete(it.id);
    else next.add(it.id);
    setExpanded(next);
  };

  return (
    <div className="rp-pane">
      <div className="filter-bar">
        <ProjectFilter value={pick} onChange={setPick} />
        <RecentToggle value={recentOnly} onChange={setRecentOnly} hidden={older} />
        <SearchBox value={query} onChange={setQuery} count={items.length} placeholder="Search the inbox" />
      </div>
      <div className="rp-body" ref={body}>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{query ? 'No matches.' : only ? 'No notifications for this project.' : 'No notifications.'}</div>
      ) : (
        <div className="inbox-list">
          {items.map((it) => {
            // what happened, said plainly (the session's name is already in the row); cached per record
            const s = sessions.get(it.sessionId);
            const v = inboxViewOf(it, s?.title);
            const who = !s ? '(deleted session)' : displayTitle(s);
            return (
            <div key={it.id} className={`inbox-item ${it.read ? '' : 'unread'} ${needItems.has(it.id) ? 'needs' : ''} ${expanded.has(it.id) ? 'open' : ''}`} onClick={() => toggle(it)}>
              <span className={`ic ${it.kind}`}>{KIND_ICON[it.kind]}</span>
              <div className="body">
                <div className="st">
                  {s && s.projectId && <span className="project-tag" style={pcStyle(projectColor(s.projectId, projects))} title={projectLabel(s.projectId, projects)}>{projectLabel(s.projectId, projects)}</span>}
                  <span className="ellipsis inbox-who">{who}</span>
                  <span className={`inbox-label ${v.tone}`}>{v.label}</span>
                  {needItems.has(it.id) && <span className="needs-badge">Needs you</span>}
                  <span className="time" title={formatDateTime(it.createdAt)}>{relativeTime(it.createdAt, now)}</span>
                  <CopyButton text={v.body} title="Copy this notification" />
                  {sessions.has(it.sessionId) && (
                    <button
                      className="btn sm ghost inbox-open"
                      title="Open the session's conversation (to answer it)"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!it.read) send({ type: 'inbox.read', id: it.id });
                        openNeed(it.sessionId);
                      }}
                    >
                      Open
                    </button>
                  )}
                </div>
                {query || expanded.has(it.id) ? (
                  // the whole notification, formatted (headings, lists, tables, code, file links)
                  <div className="tx full md chat-md" dangerouslySetInnerHTML={{ __html: inboxHtml(it, s?.title) }} />
                ) : (
                  <div className="tx">{v.line}</div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
      {items.some((i) => !i.read) && (
        <button className="btn sm ghost" onClick={() => items.filter((i) => !i.read).forEach((i) => send({ type: 'inbox.read', id: i.id }))}>Mark All Read</button>
      )}
      </div>
    </div>
  );
}

import { useRef, useEffect } from 'react';
import { firstRun } from '@/lib/firstrun';
import { useStore } from '@/store';
import { runCommand, selectAndReveal, zoomBy } from '@/commands';
import { activeSession } from '@/lib/activeProject';
import { openNotification } from '@/lib/notify';
import { Toasts } from '@/components/Toasts';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { FileRefMenu } from '@/components/FileRefMenu';
import { ProjectColorMenu } from '@/components/ProjectColorMenu';
import { NeedsYouWatcher } from '@/components/NeedsYou';
import { useLastInfoRequests } from '@/lib/lastInfo';
import { AwayWatcher } from '@/components/AwayCard';
import { PathMenu } from '@/components/PathMenu';
import { DispatchDialog } from '@/components/DispatchDialog';
import { reconnectClient } from '@/client';
import { TopBar } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { Board } from '@/components/Board';
import { SplitView } from '@/components/SplitView';
import { TabView } from '@/components/TabView';
import { TodayView } from '@/components/TodayView';
import { RightPanel, SecondPanel, useFollowSelection } from '@/components/RightPanel';
import { StatusBar } from '@/components/StatusBar';
import { Palette } from '@/components/Palette';
import { NewSessionDialog } from '@/components/NewSessionDialog';
import { ScheduleDialog } from '@/components/ScheduleDialog';
import { ImportClaudeDialog } from '@/components/ImportClaudeDialog';
import { AgentsDialog } from '@/components/AgentsDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { UsageDialog } from '@/components/UsageDialog';
import { FindBar } from '@/components/FindBar';
import { Toolbar } from '@/components/Toolbar';
import { FocusView } from '@/components/FocusView';
import { PromptDialog } from '@/components/PromptDialog';
import { ShareSplitter } from '@/components/Splitter';
import { PanelChip } from '@/components/PanelChip';

function handleKey(e: KeyboardEvent): void {
  const st = useStore.getState();
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (e.key === 'Escape') {
    if (st.paletteOpen) {
      st.closePalette();
      e.preventDefault();
    } else if (st.newSessionOpen) {
      st.closeNewSession();
      e.preventDefault();
    } else if (st.importClaude) {
      st.closeImportClaude();
      e.preventDefault();
    } else if (st.agentsOpen) {
      st.closeAgents();
      e.preventDefault();
    } else if (st.focusMode) {
      st.setFocusMode(false);
      e.preventDefault();
    }
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    runCommand('view.focus-mode');
    return;
  }
  if (e.key === 'Delete' && !ctrl && !e.shiftKey && !e.altKey) {
    // Delete removes the selected session (after a confirm) — not while typing (inputs, the terminal's textarea)
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!st.selectedId) return;
    e.preventDefault();
    runCommand('session.close');
    return;
  }
  if (e.key === 'F2') {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    runCommand('session.rename');
    return;
  }
  if (!ctrl) return;

  if (e.shiftKey && k === 'p') {
    e.preventDefault();
    runCommand('go.palette');
  } else if (e.shiftKey && k === 'w') {
    e.preventDefault();
    runCommand('go.waiting-session');
  } else if (!e.shiftKey && k === 'p') {
    e.preventDefault();
    runCommand('go.quick-open');
  } else if (e.altKey && k === 'b') {
    e.preventDefault();
    runCommand('view.right-panel');
  } else if (!e.shiftKey && k === 'b') {
    e.preventDefault();
    runCommand('view.sidebar');
  } else if (!e.shiftKey && k === 'n') {
    e.preventDefault();
    runCommand('session.new');
  } else if (k === '1') {
    e.preventDefault();
    runCommand('view.board');
  } else if (k === '2') {
    e.preventDefault();
    runCommand('view.split');
  } else if (k === '3') {
    e.preventDefault();
    runCommand('view.tabs');
  } else if (k === '4') {
    e.preventDefault();
    runCommand('view.today');
  } else if (k === '5') {
    e.preventDefault();
    runCommand('view.today');
  } else if (k === '=' || k === '+') {
    e.preventDefault();
    zoomBy(1.2);
  } else if (k === '-' || k === '_') {
    e.preventDefault();
    zoomBy(1 / 1.2);
  } else if (k === '0') {
    e.preventDefault();
    runCommand('view.zoom-reset');
  }
}

const RIGHT_TITLE: Record<string, string> = { inbox: 'Inbox', detail: 'Session', files: 'Files', web: 'Web' };

/**
 * The side panels float over the Ground, so the Ground's own fitting and centring must leave their width free:
 * --inset-l / --inset-r are the widths the open panels cover, --inset-t the toolbar's height; --tb-l / --tb-r keep the
 * toolbar clear of an open panel or of a folded panel's title.
 */
function usePanelInsets(body: React.RefObject<HTMLDivElement>, sidebarOpen: boolean, rightOpen: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const el = body.current;
      if (!el) return;
      const W = el.clientWidth;
      const left = el.querySelector<HTMLElement>(':scope > .sidebar, :scope > .panel-chip.left');
      const rights = [...el.querySelectorAll<HTMLElement>(':scope > .rightpanel, :scope > .panel-chip.right')];
      const gap = 8;
      const lw = left ? left.getBoundingClientRect().right + gap : 0;
      const rw = rights.length ? W - Math.min(...rights.map((r) => r.getBoundingClientRect().left)) + gap : 0;
      root.style.setProperty('--tb-l', `${lw}px`);
      root.style.setProperty('--tb-r', `${rw}px`);
      root.style.setProperty('--inset-l', sidebarOpen ? `${lw}px` : '0px');
      root.style.setProperty('--inset-r', rightOpen ? `${rw}px` : '0px');
      root.style.setProperty('--inset-t', '44px');
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(body.current!);
    for (const n of body.current!.querySelectorAll(':scope > .sidebar, :scope > .rightpanel, :scope > .panel-chip')) ro.observe(n);
    window.addEventListener('resize', apply);
    // a dragged splitter changes a width variable on :root: look again on every pointer move while resizing
    const move = (): void => {
      if (document.body.classList.contains('resizing')) apply();
    };
    window.addEventListener('pointermove', move);
    // a panel appearing or going (the second panel, a fold) is a change of the body's children
    const mo = new MutationObserver(() => {
      for (const n of body.current!.querySelectorAll(':scope > .sidebar, :scope > .rightpanel, :scope > .panel-chip')) ro.observe(n);
      apply();
    });
    mo.observe(body.current!, { childList: true });
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('pointermove', move);
    };
  }, [body, sidebarOpen, rightOpen]);
}

export function App(): JSX.Element {
  useFollowSelection();
  useLastInfoRequests();
  // the first start: what to call you, then the agent setup when Claude Code is not ready yet
  useEffect(() => {
    void firstRun();
  }, []);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const rightTab = useStore((s) => s.rightTab);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setRightTab = useStore((s) => s.setRightTab);
  const detached = useStore((s) => s.panelsDetached);
  const bodyRef = useRef<HTMLDivElement>(null);

  usePanelInsets(bodyRef, sidebarOpen, rightOpen);
  const viewMode = useStore((s) => s.viewMode);
  // which way the view slides in: from the right when it is further right in the bar than the one before
  const prevView = useRef(viewMode);
  const viewDir = useRef(1);
  if (prevView.current !== viewMode) {
    const order = ['board', 'split', 'tabs', 'today'];
    viewDir.current = order.indexOf(viewMode) >= order.indexOf(prevView.current) ? 1 : -1;
    prevView.current = viewMode;
  }
  const focusMode = useStore((s) => s.focusMode);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const newSessionOpen = useStore((s) => s.newSessionOpen);
  const importOpen = useStore((s) => s.importClaude !== null);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    const offs: (() => void)[] = [];
    try {
      offs.push(window.desktop.onMenu((cmd) => runCommand(cmd)));
    } catch (e) {
      console.warn('[menu] not available', e);
    }
    try {
      const ev = window.desktopEvents;
      if (ev?.onFocusSession) offs.push(ev.onFocusSession((id, command) => openNotification({ sessionId: id || undefined, command })));
      if (ev?.onDaemonRestarted) offs.push(ev.onDaemonRestarted(() => void reconnectClient()));
    } catch (e) {
      console.warn('[desktopEvents] not available', e);
    }
    return () => {
      window.removeEventListener('keydown', handleKey);
      for (const off of offs) off();
    };
  }, []);

  // On start, the Ground opens on the session that is in progress (once the sessions are in)
  const sessionCount = useStore((st) => st.sessions.size);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || sessionCount === 0) return;
    focused.current = true;
    const id = activeSession();
    if (id) setTimeout(() => selectAndReveal(id), 300);
  }, [sessionCount]);

  // Prevent browser zoom on ctrl+wheel outside the board.
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  let center: JSX.Element;
  if (focusMode) center = <FocusView />;
  else if (viewMode === 'split') center = <SplitView />;
  else if (viewMode === 'tabs') center = <TabView />;
  else if (viewMode === 'today') center = <TodayView />;
  else center = <Board />;

  return (
    <div className="app">
      <TopBar />
      {/* the side panels float over the Ground (the Ground fills the window); a folded panel is just its title */}
      <div className={`app-body floating ${detached ? '' : 'with-panels'}`} ref={bodyRef}>
        <div className={`center ${focusMode ? 'padded focus' : viewMode === 'board' ? 'ground' : 'padded'}`}>
          {!focusMode && <Toolbar />}
          {/* the view comes in from the side of its button in the bar (a new key = a new mount = the animation) */}
          <div className="view-anim" key={focusMode ? 'focus' : viewMode} style={{ '--view-dir': viewDir.current } as React.CSSProperties}>
            {center}
          </div>
        </div>
        {!detached && (sidebarOpen ? <Sidebar /> : <PanelChip side="left" title="PROJECTS" onOpen={toggleSidebar} />)}
        {!detached && sidebarOpen && <ShareSplitter cssVar="--side-share" dir={1} fallback={15} min={8} max={30} />}
        {!detached && rightOpen && <ShareSplitter cssVar="--right-share" dir={-1} fallback={35} min={18} max={60} />}
        {!detached && (rightOpen ? <RightPanel /> : <PanelChip side="right" title={RIGHT_TITLE[rightTab] ?? 'Details'} onOpen={() => setRightTab(rightTab)} />)}
        {!detached && rightOpen && <SecondPanel />}
      </div>
      <StatusBar />
      {paletteOpen && <Palette />}
      {newSessionOpen && <NewSessionDialog />}
      <ScheduleDialog />
      {importOpen && <ImportClaudeDialog />}
      <AgentsDialog />
      <SettingsDialog />
      <UsageDialog />
      <FindBar />
      <Toasts />
      <NewProjectDialog />
      <FileRefMenu />
      <ProjectColorMenu />
      <NeedsYouWatcher />
      <AwayWatcher />
      <PathMenu />
      <DispatchDialog />
      <PromptDialog />
    </div>
  );
}

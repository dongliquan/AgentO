import { useRef, useEffect } from 'react';
import { firstRun } from '@/lib/firstrun';
import { useStore } from '@/store';
import { runCommand, selectAndReveal, zoomBy } from '@/commands';
import { activeHeadCoach } from '@/lib/activeProject';
import { openNotification } from '@/lib/notify';
import { Toasts } from '@/components/Toasts';
import { OrderFlowDialog } from '@/components/OrderFlow';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { FileRefMenu } from '@/components/FileRefMenu';
import { ProjectColorMenu } from '@/components/ProjectColorMenu';
import { NeedsYouWatcher } from '@/components/NeedsYou';
import { DelegationWatcher } from '@/components/Delegations';
import { PathMenu } from '@/components/PathMenu';
import { DispatchDialog } from '@/components/DispatchDialog';
import { reconnectClient } from '@/client';
import { TopBar } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { Board } from '@/components/Board';
import { SplitView } from '@/components/SplitView';
import { TabView } from '@/components/TabView';
import { TimelineView } from '@/components/TimelineView';
import { TodayView } from '@/components/TodayView';
import { RightPanel, SecondPanel, useFollowSelection } from '@/components/RightPanel';
import { StatusBar } from '@/components/StatusBar';
import { Palette } from '@/components/Palette';
import { NewSessionDialog } from '@/components/NewSessionDialog';
import { ImportClaudeDialog } from '@/components/ImportClaudeDialog';
import { AgentsDialog } from '@/components/AgentsDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { UsageDialog } from '@/components/UsageDialog';
import { DailyReport } from '@/components/DailyReport';
import { FindBar } from '@/components/FindBar';
import { Toolbar } from '@/components/Toolbar';
import { FocusView } from '@/components/FocusView';
import { PromptDialog } from '@/components/PromptDialog';
import { ShareSplitter } from '@/components/Splitter';

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
    runCommand('view.timeline');
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

export function App(): JSX.Element {
  useFollowSelection();
  // the first start: what to call you, then the agent setup when Claude Code is not ready yet
  useEffect(() => {
    void firstRun();
  }, []);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const detached = useStore((s) => s.panelsDetached);
  const viewMode = useStore((s) => s.viewMode);
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

  // On start, the Ground opens on the head coach of the project that is in progress (once the sessions are in)
  const sessionCount = useStore((st) => st.sessions.size);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || sessionCount === 0) return;
    focused.current = true;
    const id = activeHeadCoach();
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
  else if (viewMode === 'timeline') center = <TimelineView />;
  else if (viewMode === 'today') center = <TodayView />;
  else center = <Board />;

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {!detached && sidebarOpen && <Sidebar />}
        {!detached && sidebarOpen && <ShareSplitter cssVar="--side-share" dir={1} fallback={15} min={8} max={30} />}
        <div className="center">
          {!focusMode && <Toolbar />}
          {center}
        </div>
        {!detached && rightOpen && <ShareSplitter cssVar="--right-share" dir={-1} fallback={35} min={18} max={60} />}
        {!detached && rightOpen && <RightPanel />}
        {!detached && rightOpen && <SecondPanel />}
      </div>
      <StatusBar />
      {paletteOpen && <Palette />}
      {newSessionOpen && <NewSessionDialog />}
      {importOpen && <ImportClaudeDialog />}
      <AgentsDialog />
      <SettingsDialog />
      <UsageDialog />
      <DailyReport />
      <FindBar />
      <Toasts />
      <OrderFlowDialog />
      <NewProjectDialog />
      <FileRefMenu />
      <ProjectColorMenu />
      <NeedsYouWatcher />
      <DelegationWatcher />
      <PathMenu />
      <DispatchDialog />
      <PromptDialog />
    </div>
  );
}

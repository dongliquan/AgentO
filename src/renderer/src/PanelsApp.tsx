import { useEffect } from 'react';
import { useStore } from '@/store';
import { runCommand } from '@/commands';
import { reconnectClient } from '@/client';
import { onThemeChange } from '@/lib/theme';
import { syncTitleBarColors } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { RightPanel, SecondPanel } from '@/components/RightPanel';
import { StatusBar } from '@/components/StatusBar';
import { Palette } from '@/components/Palette';
import { NewSessionDialog } from '@/components/NewSessionDialog';
import { PromptDialog } from '@/components/PromptDialog';
import { OrderFlowDialog } from '@/components/OrderFlow';
import { NewProjectDialog } from '@/components/NewProjectDialog';
import { FileRefMenu } from '@/components/FileRefMenu';
import { ProjectColorMenu } from '@/components/ProjectColorMenu';
import { NeedsYouWatcher } from '@/components/NeedsYou';
import { DelegationWatcher } from '@/components/Delegations';
import { PathMenu } from '@/components/PathMenu';
import { UsageDialog } from '@/components/UsageDialog';
import { DailyReport } from '@/components/DailyReport';
import { FindBar } from '@/components/FindBar';
import { Splitter } from '@/components/Splitter';
import logo from '@/assets/logo.png';

import { isMac, kbd } from '@/lib/keys';

function handleKey(e: KeyboardEvent): void {
  const st = useStore.getState();
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (st.paletteOpen) st.closePalette();
    else if (st.newSessionOpen) st.closeNewSession();
    else return;
    e.preventDefault();
    return;
  }
  if (!ctrl) return;
  if (e.shiftKey && k === 'p') runCommand('go.palette');
  else if (!e.shiftKey && k === 'p') runCommand('go.quick-open');
  else if (e.shiftKey && k === 'b') runCommand('view.panels-window');
  else if (e.shiftKey && k === 'w') runCommand('go.waiting-session');
  else if (!e.shiftKey && k === 'n') runCommand('session.new');
  else return;
  e.preventDefault();
}

/** Detached panels window: project/session tree and session details/inbox side by side, like a status board. */
export function PanelsApp(): JSX.Element {
  const connected = useStore((s) => s.connected);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const newSessionOpen = useStore((s) => s.newSessionOpen);

  useEffect(() => {
    document.title = 'AgentO Panels';
    window.addEventListener('keydown', handleKey);
    syncTitleBarColors();
    const offTheme = onThemeChange(() => requestAnimationFrame(syncTitleBarColors));
    const offRestart = window.desktopEvents?.onDaemonRestarted?.(() => void reconnectClient());
    return () => {
      window.removeEventListener('keydown', handleKey);
      offTheme();
      offRestart?.();
    };
  }, []);

  return (
    <div className="app panels-app">
      <div className={`topbar ${isMac ? 'mac' : ''}`}>
        <img className="app-logo" src={logo} alt="AgentO" draggable={false} />
        <span className="panels-title">AgentO Panels</span>
        <span className="grow" />
        {!connected && <div className="conn">Daemon disconnected</div>}
        <button className="btn sm ghost no-drag" title={kbd('Put the panels back into the main window (Ctrl+Shift+B)')} onClick={() => window.panels.toggle()}>
          Dock to Main Window
        </button>
      </div>
      <div className="app-body">
        <Sidebar />
        <Splitter cssVar="--panels-left-w" min={200} max={700} dir={1} />
        <RightPanel />
        <SecondPanel panels />
      </div>
      <StatusBar />
      {paletteOpen && <Palette />}
      {newSessionOpen && <NewSessionDialog />}
      <PromptDialog />
      <UsageDialog />
      <DailyReport />
      <FindBar />
      <OrderFlowDialog />
      <NewProjectDialog />
      <FileRefMenu />
      <ProjectColorMenu />
      <NeedsYouWatcher />
      <DelegationWatcher />
      <PathMenu />
    </div>
  );
}

/**
 * Wires the main window and the detached panels window together. Both windows keep their own daemon connection
 * and store; only view actions (select, reveal, open file) cross over, relayed by the main process.
 */
import { useStore } from '@/store';
import { focusTerminal, runCommand, selectAndReveal } from '@/commands';
import { IS_PANELS, relay } from '@/lib/role';

function initMain(): void {
  const st = useStore.getState();
  void window.panels.isOpen().then((open) => st.setPanelsDetached(open));
  window.panels.onState((open) => {
    useStore.getState().setPanelsDetached(open);
    if (open) relay({ kind: 'select', sessionId: useStore.getState().selectedId });
  });

  window.panels.onRelay((msg) => {
    const s = useStore.getState();
    switch (msg.kind) {
      case 'reveal':
        selectAndReveal(msg.sessionId);
        if (msg.focus) setTimeout(() => focusTerminal(msg.sessionId), 100);
        break;
      case 'openFileCard':
        s.openFileCard(msg.path, msg.cwd);
        break;
      case 'openViewerTab':
        s.openViewerTab(msg.path);
        break;
      case 'command':
        runCommand(msg.id);
        break;
      default:
        break;
    }
  });

  // Keep the panels window's details tab on the board selection.
  useStore.subscribe((next, prev) => {
    if (next.panelsDetached && next.selectedId !== prev.selectedId) relay({ kind: 'select', sessionId: next.selectedId });
  });
}

function initPanels(): void {
  // File clicks open on the main window's board; panel toggles are meaningless here and must not
  // overwrite the main window's remembered layout (localStorage is shared).
  useStore.setState({
    openFileCard: (path, cwd) => relay({ kind: 'openFileCard', path, cwd }),
    openViewerTab: (path) => relay({ kind: 'openViewerTab', path }),
    toggleSidebar: () => {},
    toggleRight: () => {}
  });

  window.panels.onRelay((msg) => {
    if (msg.kind === 'command') {
      runCommand(msg.id);
      return;
    }
    if (msg.kind !== 'select') return;
    const s = useStore.getState();
    if (msg.sessionId === s.selectedId) return;
    if (msg.sessionId === null || s.sessions.has(msg.sessionId)) s.select(msg.sessionId);
  });
}

export function initPanelsBridge(): void {
  if (!window.panels || window.panels.role === 'viewer') return;
  if (IS_PANELS) initPanels();
  else initMain();
}

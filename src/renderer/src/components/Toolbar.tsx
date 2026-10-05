import { useStore, type ViewMode } from '@/store';
import { autoArrange, fitAll, newSessionFor } from '@/commands';
import { kbd } from '@/lib/keys';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'board', label: 'Ground' },
  { id: 'split', label: 'Split' },
  { id: 'tabs', label: 'Tabs' }
];

/** VS Code-style layout toggle: a panel outline with the left or right column filled when open. */
function PanelIcon({ side, open }: { side: 'left' | 'right'; open: boolean }): JSX.Element {
  const x = side === 'left' ? 2.5 : 10;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
      <rect x={x} y="3.5" width="3.5" height="9" fill={open ? 'currentColor' : 'none'} />
      <path d={side === 'left' ? 'M6.5 2.5v11' : 'M9.5 2.5v11'} stroke="currentColor" />
    </svg>
  );
}

/** Two stacked windows: open the panels in their own window, or dock them back. */
function PopOutIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="4.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" />
      <rect x="5.5" y="1.5" width="9" height="9" rx="1.5" fill={open ? 'currentColor' : 'var(--panel)'} stroke="currentColor" />
    </svg>
  );
}

export function Toolbar(): JSX.Element {
  const viewMode = useStore((s) => s.viewMode);
  const centerView = useStore((s) => s.centerView);
  const setViewMode = useStore((s) => s.setViewMode);
  const setCenterView = useStore((s) => s.setCenterView);
  const projects = useStore((s) => s.projects);
  const selectedId = useStore((s) => s.selectedId);
  const sessions = useStore((s) => s.sessions);
  const viewerTabs = useStore((s) => s.viewerTabs);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const toggleRight = useStore((s) => s.toggleRight);
  const detached = useStore((s) => s.panelsDetached);

  const sel = selectedId ? sessions.get(selectedId) : undefined;
  // the selected session's project (and part), else the first open project; a closed project is never shown here
  const own = sel ? projects.find((p) => p.id === sel.projectId) : undefined;
  const part = own?.parentId ? own : undefined;
  const top = (part ? projects.find((p) => p.id === part.parentId) : own) ?? projects.find((p) => !p.parentId && !p.closed);
  const project = top && !top.closed ? top : undefined;
  const ids = new Set(project ? [project.id, ...projects.filter((p) => p.parentId === project.id).map((p) => p.id)] : []);
  const count = [...sessions.values()].filter((s) => ids.has(s.projectId)).length;

  return (
    <div className="toolbar">
      {!detached && (
        <button className={`icon-btn layout-toggle ${sidebarOpen ? 'on' : ''}`} title={kbd(`${sidebarOpen ? 'Hide' : 'Show'} Sidebar (Ctrl+B)`)} onClick={toggleSidebar}>
          <PanelIcon side="left" open={sidebarOpen} />
        </button>
      )}
      <div className="segmented">
        {MODES.map((m) => (
          <button key={m.id} className={viewMode === m.id && centerView === 'sessions' ? 'active' : ''} onClick={() => setViewMode(m.id)} title={kbd(`Ctrl+${MODES.indexOf(m) + 1}`)}>
            {m.label}
          </button>
        ))}
        {viewerTabs.length > 0 && (
          <button className={centerView === 'viewer' ? 'active' : ''} onClick={() => setCenterView('viewer')}>
            Viewer {viewerTabs.length}
          </button>
        )}
      </div>
      <div className="breadcrumb">
        {project ? (
          <>
            <b>{project.name}</b>
            {part && <> › {part.name}</>} › Sessions {count}
          </>
        ) : (
          <b>No Open Project</b>
        )}
      </div>
      <div className="spacer" />
      <button className="btn ghost" onClick={autoArrange} disabled={viewMode !== 'board'}>Auto Arrange</button>
      <button className="btn ghost" onClick={fitAll} disabled={viewMode !== 'board'}>Fit All</button>
      <button className="btn primary" onClick={() => newSessionFor()}>+ New Session</button>
      {!detached && (
        <button className={`icon-btn layout-toggle ${rightOpen ? 'on' : ''}`} title={kbd(`${rightOpen ? 'Hide' : 'Show'} Details Panel (Ctrl+Alt+B)`)} onClick={toggleRight}>
          <PanelIcon side="right" open={rightOpen} />
        </button>
      )}
      <button
        className={`icon-btn layout-toggle ${detached ? 'on' : ''}`}
        title={kbd(detached ? 'Dock Panels to This Window (Ctrl+Shift+B)' : 'Open Panels in Separate Window (Ctrl+Shift+B)')}
        onClick={() => window.panels?.toggle()}
      >
        <PopOutIcon open={detached} />
      </button>
    </div>
  );
}

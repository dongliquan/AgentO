import { useEffect, useState } from 'react';
import { useStore, type ViewMode } from '@/store';
import { autoArrange, fitAll, newSessionFor, newProject, runCommand } from '@/commands';
import { kbd } from '@/lib/keys';
import { onThemeChange, resolvedTheme, setThemePref } from '@/lib/theme';

/** the three ways to lay out the live sessions; Timeline (a record of finished work) stands apart from them */
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
  const focusMode = useStore((s) => s.focusMode);
  const onTimeline = viewMode === 'timeline';
  const onToday = viewMode === 'today';
  /** a record / overview page, not a session layout: the layout tools hide */
  const onPage = onTimeline || onToday;
  const setViewMode = useStore((s) => s.setViewMode);
  const projects = useStore((s) => s.projects);
  const selectedId = useStore((s) => s.selectedId);
  const sessions = useStore((s) => s.sessions);
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
          <button key={m.id} className={viewMode === m.id ? 'active' : ''} onClick={() => setViewMode(m.id)} title={kbd(`Ctrl+${MODES.indexOf(m) + 1}`)}>
            {m.label}
          </button>
        ))}
      </div>
      <span className="toolbar-sep" />
      <div className="segmented">
        <button className={onToday ? 'active' : ''} onClick={() => setViewMode('today')} title={kbd('Today — what needs you, who is working, what got done, your to-dos (Ctrl+5)')}>
          Today
        </button>
        <button className={onTimeline ? 'active' : ''} onClick={() => setViewMode('timeline')} title={kbd('Timeline — the features each project finished, by day (Ctrl+4)')}>
          Timeline
        </button>
      </div>
      <div className="breadcrumb">
        {onToday ? (
          <>
            <b>Today</b> · needs you, working, done, to do
          </>
        ) : onTimeline ? (
          <>
            <b>Timeline</b> · finished features by project and day
          </>
        ) : project ? (
          <>
            <b>{project.name}</b>
            {part && <> › {part.name}</>} › Sessions {count}
          </>
        ) : (
          <b>No Open Project</b>
        )}
      </div>
      <div className="spacer" />
      {/* Auto Arrange moves the cards (and keeps them there); Fit All only moves the view; Focus opens one session full size
          — session layout tools, not for the Timeline */}
      {!onPage && (
      <>
      <button className="btn ghost" onClick={autoArrange} disabled={viewMode !== 'board'} title="Auto Arrange — move every card into the team layout (Head Coach in the middle, projects around it) and keep it">Auto Arrange</button>
      <button className="btn ghost" onClick={fitAll} disabled={viewMode !== 'board'} title="Fit All — zoom and pan so every card is in view (the cards do not move)">Fit All</button>
      <button
        className={`btn ghost ${focusMode ? 'on' : ''}`}
        onClick={() => runCommand('view.focus-mode')}
        disabled={!focusMode && !selectedId}
        title={kbd(focusMode ? 'Exit Focus Mode (Esc / F11)' : selectedId ? 'Focus — the selected session full size, nothing else (F11)' : 'Focus — select a session first (F11)')}
      >
        {focusMode ? 'Exit Focus' : 'Focus'}
      </button>
      </>
      )}
      <button className="btn" onClick={() => void newProject()} title="New project: name, folders and an optional brief for its coach">+ New Project</button>
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
      <ThemeToggle />
    </div>
  );
}

/** Light ⇄ dark (the choice is kept; "system" in View › Theme follows the OS). */
function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState(resolvedTheme());
  useEffect(() => onThemeChange(setTheme), []);
  const dark = theme === 'dark';
  return (
    <button className="icon-btn layout-toggle" title={dark ? 'Light mode' : 'Dark mode'} aria-label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setThemePref(dark ? 'light' : 'dark')}>
      {dark ? (
        // sun
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeLinecap="round" />
        </svg>
      ) : (
        // moon
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M13.2 10.2A5.6 5.6 0 0 1 5.8 2.8a5.6 5.6 0 1 0 7.4 7.4z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

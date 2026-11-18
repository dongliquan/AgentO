import { useEffect, useState } from 'react';
import { useStore, type ViewMode } from '@/store';
import { autoArrange, fitAll, newSessionFor, runCommand } from '@/commands';
import { kbd } from '@/lib/keys';
import { getThemePref, onThemeChange, setThemePref, type ThemePref } from '@/lib/theme';

/** the views, in one group: three layouts of the live sessions, and Today (what needs you, who works, what is done) */
const MODES: { id: ViewMode; label: string; key: string; tip: string }[] = [
  { id: 'board', label: 'Ground', key: 'Ctrl+1', tip: 'Every session as a card on one canvas' },
  { id: 'split', label: 'Split', key: 'Ctrl+2', tip: 'Four sessions side by side' },
  { id: 'tabs', label: 'Tabs', key: 'Ctrl+3', tip: 'One session at a time, by project' },
  { id: 'today', label: 'Today', key: 'Ctrl+5', tip: 'What needs you, who is working, what got done, your to-dos' }
];

/** small line icons for the Ground tools */
function ToolIcon({ name }: { name: 'arrange' | 'fit' | 'focus' }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {name === 'arrange' && (
        <>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </>
      )}
      {name === 'fit' && <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />}
      {name === 'focus' && (
        <>
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
          <path d="M1.5 4V1.5H4M12 1.5h2.5V4M14.5 12v2.5H12M4 14.5H1.5V12" />
        </>
      )}
    </svg>
  );
}

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
  const onToday = viewMode === 'today';
  /** a record / overview page, not a session layout: the layout tools hide */
  const onPage = onToday;
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
  // the selected session's project, else the first open project; a closed project is never shown here
  const own = sel ? projects.find((p) => p.id === sel.projectId) : undefined;
  const top = own ?? projects.find((p) => !p.closed);
  const project = top && !top.closed ? top : undefined;
  const count = project ? [...sessions.values()].filter((s) => s.projectId === project.id).length : 0;

  return (
    <div className="toolbar">
      {!detached && (
        <button className={`icon-btn layout-toggle ${sidebarOpen ? 'on' : ''}`} title={kbd(`${sidebarOpen ? 'Hide' : 'Show'} Sidebar (Ctrl+B)`)} onClick={toggleSidebar}>
          <PanelIcon side="left" open={sidebarOpen} />
        </button>
      )}
      <div className="segmented">
        {MODES.map((m) => (
          <button key={m.id} className={viewMode === m.id ? 'active' : ''} onClick={() => setViewMode(m.id)} title={kbd(`${m.label} — ${m.tip} (${m.key})`)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="breadcrumb">
        {onToday ? (
          <>
            <b>Today</b> · needs you, working, done, to do
          </>
        ) : project ? (
          <>
            <b>{project.name}</b>
             › Sessions {count}
          </>
        ) : (
          <b>No Open Project</b>
        )}
      </div>
      <div className="spacer" />
      {/* layout tools, as one quiet group: Arrange and Fit belong to the Ground; Focus opens the selected session full size */}
      {!onPage && (
        <div className="tool-group">
          {viewMode === 'board' && (
            <>
              <button className="icon-btn" onClick={autoArrange} title="Auto Arrange — lay every card out in a grid by project and keep it" aria-label="Auto Arrange">
                <ToolIcon name="arrange" />
              </button>
              <button className="icon-btn" onClick={fitAll} title="Fit All — zoom and pan so every card is in view (the cards do not move)" aria-label="Fit All">
                <ToolIcon name="fit" />
              </button>
            </>
          )}
          <button
            className={`icon-btn ${focusMode ? 'on' : ''}`}
            onClick={() => runCommand('view.focus-mode')}
            disabled={!focusMode && !selectedId}
            title={kbd(focusMode ? 'Exit Focus Mode (Esc / F11)' : selectedId ? 'Focus — the selected session full size, nothing else (F11)' : 'Focus — select a session first (F11)')}
            aria-label="Focus"
          >
            <ToolIcon name="focus" />
          </button>
        </div>
      )}
      {/* the one accented button; a new project is the + at the top of the project tree (and File › New Project) */}
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

const THEME_LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark' };

/**
 * Light ⇄ dark, as in the shared theme spec (manager's correction #T48): an icon button only — the icon shows the
 * current theme (sun = light, moon = dark), the name is in the tooltip. Also View › Theme.
 */
function ThemeToggle(): JSX.Element {
  const [pref, setPref] = useState(getThemePref());
  useEffect(() => onThemeChange(() => setPref(getThemePref())), []);
  const next: ThemePref = pref === 'dark' ? 'light' : 'dark';
  const title = `Theme: ${THEME_LABEL[pref]} — click for ${THEME_LABEL[next]}`;
  return (
    <button className="icon-btn layout-toggle theme-toggle" title={title} aria-label={title} onClick={() => setThemePref(next)}>
      {pref === 'light' ? (
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

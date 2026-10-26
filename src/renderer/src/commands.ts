import type { AgentKind, Session } from '@shared/protocol';
import { useToasts } from '@/lib/notify';
import { readUsage, resetUsage } from '@/lib/uiUsage';
import { showSessionTab } from '@/panels-bridge';
import { useNewProject } from '@/components/NewProjectDialog';
import { useStore, ZOOM_MAX, ZOOM_MIN } from '@/store';
import { send } from '@/client';
import { AGENT_LABELS } from '@/lib/format';
import { askText } from '@/lib/prompt';
import { setThemePref } from '@/lib/theme';
import { useWebPages } from '@/lib/webpages';
import { IS_PANELS, relay } from '@/lib/role';
import { openSessions } from '@/lib/closedIds';
import { kbd } from '@/lib/keys';
import { useFindBar } from '@/components/FindBar';
import { getBuffer } from '@/lib/buffers';

export interface CommandDef {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

const ZOOM_STEP = 1.2;

function selected(): Session | undefined {
  const st = useStore.getState();
  return st.selectedId ? st.sessions.get(st.selectedId) : undefined;
}

export function focusTerminal(sessionId: string): void {
  if (IS_PANELS) {
    relay({ kind: 'reveal', sessionId, focus: true });
    return;
  }
  // TerminalView listens for this custom event and focuses its xterm.
  window.dispatchEvent(new CustomEvent('asm:focus-terminal', { detail: { sessionId } }));
}

export function zoomBy(factor: number): void {
  const st = useStore.getState();
  const el = document.querySelector<HTMLElement>('.board');
  const cx = el ? el.clientWidth / 2 : 0;
  const cy = el ? el.clientHeight / 2 : 0;
  const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, st.zoom * factor));
  const k = nz / st.zoom;
  st.setZoom(nz, cx - (cx - st.panX) * k, cy - (cy - st.panY) * k);
}

export function fitAll(): void {
  const st = useStore.getState();
  const el = document.querySelector<HTMLElement>('.board');
  if (!el) return;
  const items: { x: number; y: number; w: number; h: number }[] = [...openSessions(st.sessions, st.projects), ...st.fileCards.values()];
  if (items.length === 0) {
    st.setZoom(1, 40, 40);
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of items) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  const pad = 40;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(el.clientWidth / bw, el.clientHeight / bh)));
  const panX = (el.clientWidth - (maxX - minX) * z) / 2 - minX * z;
  const panY = (el.clientHeight - (maxY - minY) * z) / 2 - minY * z;
  st.setZoom(z, panX, panY);
}

export function autoArrange(): void {
  const st = useStore.getState();
  st.autoArrange();
  for (const s of openSessions(useStore.getState().sessions, useStore.getState().projects)) {
    send({ type: 'session.update', id: s.id, patch: { x: s.x, y: s.y, w: s.w, h: s.h } });
  }
  fitAll();
}

export function selectAndReveal(sessionId: string): void {
  const st = useStore.getState();
  if (!st.sessions.has(sessionId)) return;
  st.select(sessionId);
  if (IS_PANELS) {
    relay({ kind: 'reveal', sessionId });
    // the panels window: the session tree and the Session tab are its view of a session
    showSessionTab();
    return;
  }
  st.setCenterView('sessions');
  if (st.viewMode === 'tabs') st.setActiveTabSession(sessionId);
  st.requestPanTo(sessionId);
}

export function gotoNextWaiting(): void {
  const st = useStore.getState();
  const list = openSessions(st.sessions, st.projects).filter((s) => s.status === 'waiting').sort((a, b) => a.updatedAt - b.updatedAt);
  if (list.length === 0) return;
  const idx = st.selectedId ? list.findIndex((s) => s.id === st.selectedId) : -1;
  const next = list[(idx + 1) % list.length];
  selectAndReveal(next.id);
  focusTerminal(next.id);
}

function cycleSession(dir: 1 | -1): void {
  const st = useStore.getState();
  const list = openSessions(st.sessions, st.projects).sort((a, b) => a.createdAt - b.createdAt);
  if (list.length === 0) return;
  const idx = st.selectedId ? list.findIndex((s) => s.id === st.selectedId) : -1;
  const next = list[(idx + dir + list.length) % list.length];
  selectAndReveal(next.id);
}

export function newSessionFor(agent?: AgentKind): void {
  const st = useStore.getState();
  const sel = selected();
  st.openNewSession({ projectId: sel?.projectId, folderId: sel?.folderId, agent });
}

/** Remove a session after a confirm (its process stops; a Claude conversation's transcript stays on disk). */
export function removeSession(id: string): void {
  const s = useStore.getState().sessions.get(id);
  if (!s) return;
  if (window.confirm(`Remove session "${s.title}"?\n\nIts process stops. A Claude Code conversation stays on disk and can be imported again.`)) {
    send({ type: 'session.remove', id: s.id });
  }
}

/** Rename a session from a prompt (works without its card on the Ground, e.g. in a collapsed group). */
export async function renameSession(id: string): Promise<void> {
  const s = useStore.getState().sessions.get(id);
  if (!s) return;
  const name = await askText('Rename session', { initial: s.title, placeholder: 'Session name' });
  if (name && name.trim() && name.trim() !== s.title) send({ type: 'session.update', id, patch: { title: name.trim() } });
}

/** Rename a project or a part. */
export async function renameProject(id: string): Promise<void> {
  const p = useStore.getState().projects.find((x) => x.id === id);
  if (!p) return;
  const name = await askText(p.parentId ? 'Rename part' : 'Rename project', { initial: p.name, placeholder: 'Name' });
  if (name && name.trim() && name.trim() !== p.name) send({ type: 'project.rename', id, name: name.trim() });
}

export function renameSelected(): void {
  const s = selected();
  if (!s) return;
  // a card on screen edits its title in place; without one (a collapsed group, another view) ask instead
  if (document.querySelector(`[data-session-card="${s.id}"]`)) window.dispatchEvent(new CustomEvent('asm:rename', { detail: { sessionId: s.id } }));
  else void renameSession(s.id);
}

export function exportSession(id: string): void {
  const st = useStore.getState();
  const s = st.sessions.get(id);
  if (!s) return;
  const buf = getBuffer(id) ?? '';
  const blob = new Blob([buf], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.title.replace(/[\\/:*?"<>|]/g, '_')}.log`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The project to save: the selected session's project, or the only open one; otherwise ask by name. */
export async function saveProject(projectId?: string): Promise<void> {
  const st = useStore.getState();
  const tops = st.projects.filter((p) => !p.parentId);
  const rootOf = (id: string): string => st.projects.find((p) => p.id === id)?.parentId ?? id;
  let id = projectId ?? (selected() ? rootOf(selected()!.projectId) : undefined);
  if (!id || !tops.some((p) => p.id === id)) {
    const open = tops.filter((p) => !p.closed);
    if (open.length === 1) id = open[0]!.id;
    else {
      const name = await askText('Save which project?', { placeholder: tops.map((p) => p.name).join(' / ') });
      id = tops.find((p) => p.name === name?.trim())?.id;
      if (!id) return;
    }
  }
  send({ type: 'project.export', id });
}

/** The head coach (created if missing) sorts the project's sessions into parts with coaches, then reports. */
export function organizeTeam(projectId: string): void {
  const st = useStore.getState();
  const p = st.projects.find((x) => x.id === projectId);
  if (!p) return;
  const n = [...st.sessions.values()].filter((s) => s.projectId === p.id || st.projects.some((x) => x.parentId === p.id && x.id === s.projectId)).length;
  const hasHead = [...st.sessions.values()].some((s) => s.role === 'head' && s.projectId === p.id);
  const msg =
    `Organize "${p.name}"?\n\n` +
    `${hasHead ? 'The coach' : 'A coach is created first. It'} reads the ${n} session(s) — without waking them — ` +
    'sorts them into parts, picks a coach for each part, and reports to you. No work is handed out yet.';
  if (window.confirm(msg)) {
    send({ type: 'team.organize', projectId: p.id });
    st.setRightTab('orders');
  }
}

/** Pick a .agento file and open it as a new project (sessions are not started). */
export function openProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.agento,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void f.text().then((data) => send({ type: 'project.import', data }));
  };
  input.click();
}

/** The New Project dialog: name, folders, and an optional brief that also makes and briefs the head coach. */
export async function newProject(): Promise<void> {
  useNewProject.getState().show();
}

function withSelected(fn: (s: Session) => void): () => void {
  return () => {
    const s = selected();
    if (s) fn(s);
  };
}

export const COMMANDS: CommandDef[] = [
  { id: 'project.new', label: 'New Project', run: () => void newProject() },
  { id: 'project.import', label: 'Open Project File…', run: openProjectFile },
  { id: 'session.import-claude', label: 'Import Claude Code Sessions…', run: () => {
    const sel = selected();
    useStore.getState().openImportClaude(sel?.folderId ? { projectId: sel.projectId, folderId: sel.folderId } : undefined);
  } },
  { id: 'project.export', label: 'Save Project As…', run: () => void saveProject() },
  { id: 'project.add-folder', label: 'Add Folder to Project', run: () => {
    const st = useStore.getState();
    const sel = selected();
    const projectId = sel?.projectId ?? st.projects.find((p) => !p.parentId && !p.closed)?.id;
    if (!projectId) {
      window.alert('Create a project first.');
      return;
    }
    void window.desktop.pickFolder().then((p) => {
      if (p) send({ type: 'folder.add', projectId, path: p });
    });
  } },
  { id: 'session.new', label: 'New Session…', shortcut: kbd('Ctrl+N'), run: () => newSessionFor() },
  { id: 'web.gemini', label: 'Open Web: Gemini', run: () => useWebPages.getState().open('https://gemini.google.com/app', 'Gemini') },
  { id: 'web.chatgpt', label: 'Open Web: ChatGPT', run: () => useWebPages.getState().open('https://chatgpt.com/', 'ChatGPT') },
  { id: 'web.ernie', label: 'Open Web: 文心一言', run: () => useWebPages.getState().open('https://yiyan.baidu.com/', '文心一言') },
  { id: 'session.new-chat.codex', label: 'New Chat: ChatGPT (Codex)', run: () => send({ type: 'chat.new', agent: 'codex' }) },
  { id: 'session.new-chat.claude', label: 'New Chat: Claude', run: () => send({ type: 'chat.new', agent: 'claude' }) },
  { id: 'session.new.claude', label: `New Session: ${AGENT_LABELS.claude}`, run: () => newSessionFor('claude') },
  { id: 'session.new.codex', label: `New Session: ${AGENT_LABELS.codex}`, run: () => newSessionFor('codex') },
  { id: 'session.new.gemini', label: `New Session: ${AGENT_LABELS.gemini}`, run: () => newSessionFor('gemini') },
  { id: 'session.new.ollama', label: `New Session: ${AGENT_LABELS.ollama}`, run: () => newSessionFor('ollama') },
  { id: 'session.new.shell', label: `New Session: ${AGENT_LABELS.shell}`, run: () => newSessionFor('shell') },
  { id: 'session.close', label: 'Remove Session', shortcut: 'Delete', run: withSelected((s) => removeSession(s.id)) },
  { id: 'session.rename', label: 'Rename Session', shortcut: 'F2', run: renameSelected },
  { id: 'session.restart', label: 'Restart Session', run: withSelected((s) => send({ type: 'session.restart', id: s.id })) },
  { id: 'session.resume', label: 'Resume Session', run: withSelected((s) => send({ type: 'session.resume', id: s.id })) },
  { id: 'session.hibernate', label: 'Hibernate Session', run: withSelected((s) => send({ type: 'session.hibernate', id: s.id })) },
  { id: 'session.stop', label: 'Stop Session (Ctrl+C)', run: withSelected((s) => send({ type: 'session.stop', id: s.id })) },
  { id: 'session.kill', label: 'Kill Session', run: withSelected((s) => send({ type: 'session.kill', id: s.id })) },
  { id: 'session.duplicate', label: 'Duplicate Session', run: withSelected((s) =>
    s.role === 'player' && send({ type: 'session.create', projectId: s.projectId, folderId: s.folderId, agent: s.agent, title: `${s.title} (copy)`, cols: s.cols || 100, rows: s.rows || 30 })
  ) },
  { id: 'session.open-folder', label: 'Open Session Folder', run: withSelected((s) => void window.desktop.openPath(s.cwd)) },
  { id: 'session.open-vscode', label: 'Open in VS Code', run: withSelected((s) => void window.desktop.openInVsCode(s.cwd)) },
  { id: 'session.open-terminal', label: 'Open External Terminal', run: withSelected((s) => void window.desktop.openExternalTerminal(s.cwd)) },
  { id: 'session.export', label: 'Export Session Log', run: withSelected((s) => exportSession(s.id)) },
  { id: 'session.open-log', label: 'Open Session Log', run: withSelected((s) => exportSession(s.id)) },
  { id: 'terminal.clear', label: 'Clear Terminal', run: withSelected((s) => send({ type: 'session.input', id: s.id, data: '\x0c' })) },
  { id: 'edit.find', label: 'Find', shortcut: kbd('Ctrl+F'), run: () => useFindBar.getState().show() },
  { id: 'terminal.find', label: 'Find in Terminal', run: withSelected((s) => focusTerminal(s.id)) },
  { id: 'view.board', label: 'View: Ground', shortcut: kbd('Ctrl+1'), run: () => useStore.getState().setViewMode('board') },
  { id: 'view.split', label: 'View: Split', shortcut: kbd('Ctrl+2'), run: () => useStore.getState().setViewMode('split') },
  { id: 'view.tabs', label: 'View: Tabs', shortcut: kbd('Ctrl+3'), run: () => useStore.getState().setViewMode('tabs') },
  { id: 'view.timeline', label: 'View: Timeline', shortcut: kbd('Ctrl+4'), run: () => useStore.getState().setViewMode('timeline') },
  { id: 'view.today', label: 'View: Today', shortcut: kbd('Ctrl+5'), run: () => useStore.getState().setViewMode('today') },
  { id: 'help.ui-usage', label: 'Help: UI Usage (views and tabs opened, this PC only)', run: showUiUsage },
  { id: 'help.ui-usage-reset', label: 'Help: Reset UI Usage Counts', run: () => { resetUsage(); useToasts.getState().push({ title: 'UI usage counts reset', body: 'Counting again from now.' }); } },
  { id: 'view.zoom-in', label: 'Zoom In', shortcut: kbd('Ctrl+='), run: () => zoomBy(ZOOM_STEP) },
  { id: 'view.zoom-out', label: 'Zoom Out', shortcut: kbd('Ctrl+-'), run: () => zoomBy(1 / ZOOM_STEP) },
  { id: 'view.zoom-reset', label: 'Reset Zoom', shortcut: kbd('Ctrl+0'), run: () => useStore.getState().setZoom(1) },
  { id: 'view.zoom-fit', label: 'Fit All', run: fitAll },
  { id: 'view.minimap', label: 'Toggle Minimap', run: () => useStore.getState().toggleMinimap() },
  { id: 'view.auto-arrange', label: 'Auto Arrange', run: autoArrange },
  { id: 'view.sidebar', label: 'Toggle Sidebar', shortcut: kbd('Ctrl+B'), run: () => useStore.getState().toggleSidebar() },
  { id: 'view.right-panel', label: 'Toggle Right Panel', shortcut: kbd('Ctrl+Alt+B'), run: () => useStore.getState().toggleRight() },
  { id: 'view.inbox', label: 'Show Inbox', run: () => useStore.getState().setActivity('inbox') },
  { id: 'view.orders', label: 'Manager (give the team an order)', run: () => {
    const st = useStore.getState();
    // detached: the right panel lives in the panels window
    if (!IS_PANELS && st.panelsDetached) relay({ kind: 'command', id: 'view.orders' });
    else st.setRightTab('orders');
  } },
  { id: 'view.panels-window', label: 'Panels in Separate Window', shortcut: kbd('Ctrl+Shift+B'), run: () => window.panels?.toggle() },
  { id: 'view.focus-mode', label: 'Focus Mode', shortcut: 'F11', run: () => {
    const st = useStore.getState();
    if (st.focusMode) st.setFocusMode(false);
    else if (st.selectedId) st.setFocusMode(true);
  } },
  { id: 'view.fullscreen', label: 'Full Screen', run: () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } },
  { id: 'go.palette', label: 'Command Palette', shortcut: kbd('Ctrl+Shift+P'), run: () => useStore.getState().openPalette('command') },
  { id: 'go.quick-open', label: 'Quick Open', shortcut: kbd('Ctrl+P'), run: () => useStore.getState().openPalette('quick') },
  { id: 'go.next-session', label: 'Next Session', run: () => cycleSession(1) },
  { id: 'go.prev-session', label: 'Previous Session', run: () => cycleSession(-1) },
  { id: 'go.waiting-session', label: 'Go to Waiting Session', shortcut: kbd('Ctrl+Shift+W'), run: gotoNextWaiting },
  { id: 'go.next-waiting', label: 'Go to Waiting Session', shortcut: kbd('Ctrl+Shift+W'), run: gotoNextWaiting },
  { id: 'agents.detect', label: 'Re-detect Agents', run: () => useStore.getState().openAgents() },
  { id: 'usage.refresh', label: 'Refresh Usage', run: () => send({ type: 'usage.refresh' }) },
  { id: 'app.settings', label: 'Settings', run: () => window.alert('Settings are not available yet.') },
  { id: 'agents.settings', label: 'Agent Connections (Claude, ChatGPT, Gemini)', run: () => useStore.getState().openAgents() },
  { id: 'agents.login-status', label: 'Check Agent Sign-in', run: () => useStore.getState().openAgents() },
  { id: 'view.theme.light', label: 'Theme: Light', run: () => setThemePref('light') },
  { id: 'view.theme.dark', label: 'Theme: Dark', run: () => setThemePref('dark') },
  { id: 'view.theme.system', label: 'Theme: System', run: () => setThemePref('system') },
  { id: 'help.docs', label: 'Documentation', run: () => window.alert('Documentation is not available yet.') },
  { id: 'help.check-update', label: 'Check for Updates', run: () => window.alert('Update checking is not available yet.') },
  { id: 'help.about', label: 'About', run: () => {
    const st = useStore.getState();
    window.alert(`AgentO\nDaemon version: ${st.daemonVersion || '-'} · PID ${st.daemonPid ?? '-'}\nConnection: ${st.connected ? 'connected' : 'disconnected'}`);
  } },
  { id: 'help.shortcuts', label: 'Show Keyboard Shortcuts', run: () => window.alert(
    ['Ctrl+N  New session', 'Ctrl+B  Sidebar', 'Ctrl+1/2/3  Board/Split/Tabs', 'Ctrl+= / Ctrl+- / Ctrl+0  Zoom in/out/reset', 'Ctrl+P  Quick open', 'Ctrl+Shift+P  Commands', 'Ctrl+Shift+W  Waiting session', 'F2  Rename', 'F11  Focus mode', 'Esc  Close'].map(kbd).join('\n')
  ) }
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

/** Commands the panels window runs itself; everything else acts on the board and runs in the main window. */
const PANELS_LOCAL = new Set(['go.palette', 'go.quick-open', 'view.panels-window', 'view.orders', 'project.new', 'view.inbox', 'usage.refresh']);

/** Runs a menu/palette command id. Also accepts 'focus-session:<id>'. */
export function runCommand(id: string): boolean {
  if (IS_PANELS && !id.startsWith('focus-session:') && !PANELS_LOCAL.has(id) && !id.startsWith('view.theme.')) {
    relay({ kind: 'command', id });
    return true;
  }
  if (id.startsWith('focus-session:')) {
    selectAndReveal(id.slice('focus-session:'.length));
    return true;
  }
  const c = byId.get(id);
  if (!c) {
    console.info('[command] unhandled', id);
    return false;
  }
  c.run();
  return true;
}

/** The views and tabs opened since counting began (both windows), most used first. */
function showUiUsage(): void {
  const u = readUsage();
  const days = Math.max(1, Math.round((Date.now() - u.since) / 86_400_000));
  const rows = Object.entries(u.counts).sort((a, b) => b[1] - a[1]);
  useToasts.getState().push({
    title: `UI usage — ${days} day${days === 1 ? '' : 's'} (this PC only)`,
    body: rows.length ? rows.map(([k, n]) => `${n}× ${k}`).join('\n') : 'Nothing counted yet.'
  });
}

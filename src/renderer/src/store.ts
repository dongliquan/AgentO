import { create } from 'zustand';
import type { AgentConnection, ClaudeSessionInfo, FsEntry, InboxItem, Project, Routine, ServerMessage, Session, SessionStatus, UsageInfo, UsageReport } from '@shared/protocol';
import type { AgentDefEx } from '@shared/extra';
import { emitTerm } from '@/lib/termbus';
import { appendBuffer, dropBuffer, setBuffer } from '@/lib/buffers';
import { arrangeTeam } from '@shared/layout';
import { closedSessionIds, openSessions } from '@/lib/closedIds';
import { applyChatSnapshot, applyChatUpsert, dropChat } from '@/lib/chat';

export { BUFFER_CAP } from '@/lib/buffers';
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 2.5;
export type ViewMode = 'board' | 'split' | 'tabs';
/** orders: the Manager tab (conversation + order box) */
export type RightTab = 'detail' | 'inbox' | 'orders' | 'log' | 'web';
/** projects: the left sidebar's tree · inbox: also opens the right panel's Inbox tab */
export type ActivityView = 'projects' | 'inbox';
export type TreeFilter = 'all' | 'sessions';

export interface FileCard {
  id: string;
  path: string;
  cwd: string;
  /** view: rendered (Markdown, JSON tree, CSV table) · raw: the text · diff: git diff (not yet) */
  mode: 'view' | 'raw' | 'diff';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewerTab {
  id: string;
  path: string;
  name: string;
}

export interface TimelineEntry {
  id: string;
  sessionId: string;
  from: SessionStatus | null;
  to: SessionStatus;
  at: number;
}

export interface NewSessionPreset {
  projectId?: string;
  folderId?: string;
  agent?: string;
}

export interface FileContent {
  content: string;
  truncated: boolean;
  at: number;
}

export interface AppState {
  connected: boolean;
  daemonPid: number | null;
  daemonVersion: string;
  projects: Project[];
  sessions: Map<string, Session>;
  inbox: InboxItem[];
  /** repeating orders (Manager tab) */
  routines: Routine[];
  /** the last team message typed into a session — its card replays it in the message box */
  delivered: Record<string, { text: string; nonce: number }>;
  usage: UsageInfo[];
  agents: AgentDefEx[];
  lastError: string | null;

  selectedId: string | null;
  selectedFileCardId: string | null;
  viewMode: ViewMode;
  zoom: number;
  panX: number;
  panY: number;
  panRequest: { sessionId: string; nonce: number } | null;
  fileCards: Map<string, FileCard>;
  viewerTabs: ViewerTab[];
  activeTabId: string | null;
  centerView: 'sessions' | 'viewer';
  timeline: TimelineEntry[];
  focusMode: boolean;
  sidebarOpen: boolean;
  rightOpen: boolean;
  /** main window: the sidebar and right panel are shown in the separate panels window instead */
  panelsDetached: boolean;
  /** Ground: ids of collapsed groups (projects / parts), remembered per viewer */
  collapsedGroups: string[];
  rightTab: RightTab;
  activity: ActivityView;
  treeFilter: TreeFilter;
  paletteOpen: boolean;
  paletteMode: 'quick' | 'command';
  newSessionOpen: boolean;
  newSessionPreset: NewSessionPreset;
  /** Import Claude Code Sessions dialog (open with an optional folder) and the sessions the daemon found */
  importClaude: { projectId?: string; folderId?: string } | null;
  /** Agents › Connections dialog and the CLIs' install / sign-in state (null until the daemon answers) */
  agentsOpen: boolean;
  usageOpen: boolean;
  usageReport: UsageReport | null;
  agentConnections: AgentConnection[] | null;
  claudeSessions: { path: string; items: ClaudeSessionInfo[] } | null;
  /** the manager's orders marked done (Tasks): order record id → when */
  doneOrders: Record<string, number>;
  /** Quick Open file search: the latest answer (ref = the query it answers) */
  fileSearch: { ref: string; items: { path: string; root: string }[] } | null;
  activeTabSessionId: string | null;

  fsLists: Map<string, FsEntry[]>;
  fileContents: Map<string, FileContent>;
  changed: Map<string, FsEntry[]>;

  // actions
  setConnected(v: boolean): void;
  apply(msg: ServerMessage): void;
  select(id: string | null): void;
  selectFileCard(id: string | null): void;
  setViewMode(m: ViewMode): void;
  setZoom(z: number, panX?: number, panY?: number): void;
  setPan(x: number, y: number): void;
  requestPanTo(sessionId: string): void;
  patchSessionLocal(id: string, patch: Partial<Session>): void;
  openFileCard(path: string, cwd: string, at?: { x: number; y: number }): void;
  updateFileCard(id: string, patch: Partial<FileCard>): void;
  closeFileCard(id: string): void;
  openViewerTab(path: string): void;
  closeViewerTab(id: string): void;
  setActiveTab(id: string | null): void;
  setCenterView(v: 'sessions' | 'viewer'): void;
  setFocusMode(v: boolean): void;
  toggleSidebar(): void;
  toggleRight(): void;
  setPanelsDetached(v: boolean): void;
  toggleGroup(id: string): void;
  setRightTab(t: RightTab): void;
  setActivity(a: ActivityView): void;
  setTreeFilter(f: TreeFilter): void;
  openPalette(mode: 'quick' | 'command'): void;
  closePalette(): void;
  openNewSession(preset?: NewSessionPreset): void;
  closeNewSession(): void;
  openImportClaude(at?: { projectId?: string; folderId?: string }): void;
  openAgents(): void;
  openUsage(): void;
  closeUsage(): void;
  closeAgents(): void;
  closeImportClaude(): void;
  setActiveTabSession(id: string | null): void;
  autoArrange(): void;
}

let idSeq = 0;
const uid = (prefix = 'id'): string => `${prefix}_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

/** Per-viewer layout flags (panel visibility) kept in localStorage; always falls back to the default. */
function readFlag(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

/** Saves text as a file through the browser download (Electron asks where to save). */
function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** increases per team.delivered event, so the same text delivered twice still replays twice */
let deliveryNonce = 0;

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeFlag(key: string, v: boolean): boolean {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  return v;
}

export const useStore = create<AppState>((set, get) => ({
  connected: false,
  daemonPid: null,
  daemonVersion: '',
  projects: [],
  sessions: new Map(),
  inbox: [],
  routines: [],
  delivered: {},
  usage: [],
  agents: [],
  lastError: null,

  selectedId: null,
  selectedFileCardId: null,
  viewMode: 'board',
  zoom: 1,
  panX: 40,
  panY: 40,
  panRequest: null,
  fileCards: new Map(),
  viewerTabs: [],
  activeTabId: null,
  centerView: 'sessions',
  timeline: [],
  focusMode: false,
  sidebarOpen: readFlag('asm.sidebarOpen', true),
  rightOpen: readFlag('asm.rightOpen', true),
  panelsDetached: false,
  collapsedGroups: readList('asm.collapsedGroups'),
  rightTab: 'orders',
  activity: 'projects',
  treeFilter: 'all',
  paletteOpen: false,
  paletteMode: 'quick',
  newSessionOpen: false,
  newSessionPreset: {},
  importClaude: null,
  agentsOpen: false,
  usageOpen: false,
  usageReport: null,
  agentConnections: null,
  claudeSessions: null,
  fileSearch: null,
  doneOrders: {},
  activeTabSessionId: null,

  fsLists: new Map(),
  fileContents: new Map(),
  changed: new Map(),

  setConnected: (v) => set({ connected: v }),

  apply: (msg) => {
    switch (msg.type) {
      case 'welcome': {
        const sessions = new Map<string, Session>();
        for (const s of msg.sessions) sessions.set(s.id, s);
        set({
          daemonPid: msg.daemonPid,
          daemonVersion: msg.version,
          projects: msg.projects,
          sessions,
          inbox: msg.inbox,
          doneOrders: msg.doneOrders ?? {},
          routines: msg.routines ?? [],
          usage: msg.usage,
          agents: msg.agents as AgentDefEx[],
          lastError: null
        });
        break;
      }
      case 'projects': {
        const sel = get().selectedId ? get().sessions.get(get().selectedId!) : undefined;
        const top = sel ? msg.projects.find((p) => p.id === sel.projectId) : undefined;
        const root = top?.parentId ? msg.projects.find((p) => p.id === top.parentId) : top;
        set({ projects: msg.projects, ...(root?.closed ? { selectedId: null } : {}) });
        break;
      }
      case 'session.upsert': {
        const prev = get().sessions.get(msg.session.id);
        const sessions = new Map(get().sessions);
        sessions.set(msg.session.id, msg.session);
        const patch: Partial<AppState> = { sessions };
        if (!prev || prev.status !== msg.session.status) {
          const entry: TimelineEntry = {
            id: uid('tl'),
            sessionId: msg.session.id,
            from: prev?.status ?? null,
            to: msg.session.status,
            at: Date.now()
          };
          const tl = [...get().timeline, entry];
          patch.timeline = tl.length > 500 ? tl.slice(tl.length - 500) : tl;
        }
        set(patch);
        break;
      }
      case 'chat.snapshot':
        applyChatSnapshot(msg.id, msg.entries, msg.available);
        break;
      case 'chat.upsert':
        applyChatUpsert(msg.id, msg.entries);
        break;
      case 'session.removed': {
        dropChat(msg.id);
        const sessions = new Map(get().sessions);
        sessions.delete(msg.id);
        dropBuffer(msg.id);
        const patch: Partial<AppState> = { sessions };
        if (get().selectedId === msg.id) patch.selectedId = null;
        if (get().activeTabSessionId === msg.id) patch.activeTabSessionId = null;
        set(patch);
        break;
      }
      case 'session.data':
        appendBuffer(msg.id, msg.data);
        emitTerm(msg.id, { kind: 'data', data: msg.data });
        break;
      case 'session.scrollback': {
        setBuffer(msg.id, msg.data);
        emitTerm(msg.id, { kind: 'scrollback', data: msg.data });
        break;
      }
      case 'inbox':
        set({ inbox: msg.items });
        break;
      case 'inbox.delta': {
        // newest first, like the daemon's list
        const drop = new Set([...msg.remove, ...msg.upsert.map((i) => i.id)]);
        const inbox = [...msg.upsert, ...get().inbox.filter((i) => !drop.has(i.id))].sort((a, b) => b.createdAt - a.createdAt);
        set({ inbox });
        break;
      }
      case 'routines':
        set({ routines: msg.routines });
        break;
      case 'usage.report':
        set({ usageReport: msg.report });
        break;
      case 'agents.status':
        set({ agentConnections: msg.items });
        break;
      case 'orders.done':
        set({ doneOrders: msg.done });
        break;
      case 'fs.search.result':
        set({ fileSearch: { ref: msg.ref, items: msg.items } });
        break;
      case 'claude.sessions':
        set({ claudeSessions: { path: msg.path, items: msg.items } });
        break;
      case 'project.exported':
        downloadText(`${msg.name.replace(/[\\/:*?"<>|]/g, '_')}.agento`, msg.data);
        break;
      case 'team.delivered':
        set({ delivered: { ...get().delivered, [msg.sessionId]: { text: msg.text, nonce: ++deliveryNonce } } });
        break;
      case 'usage':
        set({ usage: msg.usage });
        break;
      case 'fs.list.result': {
        const fsLists = new Map(get().fsLists);
        fsLists.set(msg.path, msg.entries);
        set({ fsLists });
        break;
      }
      case 'fs.read.result': {
        const fileContents = new Map(get().fileContents);
        fileContents.set(msg.path, { content: msg.content, truncated: msg.truncated, at: Date.now() });
        set({ fileContents });
        break;
      }
      case 'fs.changed.result': {
        const changed = new Map(get().changed);
        changed.set(msg.cwd, msg.entries);
        set({ changed });
        break;
      }
      case 'error':
        console.warn('[daemon error]', msg.message, msg.ref);
        set({ lastError: msg.message });
        break;
    }
  },

  select: (id) => {
    const patch: Partial<AppState> = { selectedId: id };
    if (id) {
      patch.selectedFileCardId = null;
      // the right panel keeps its tab: picking a session on the Ground or in the tree does not switch to Session
      if (get().viewMode === 'tabs') patch.activeTabSessionId = id;
    }
    set(patch);
  },
  selectFileCard: (id) => set({ selectedFileCardId: id }),
  setViewMode: (m) => {
    const patch: Partial<AppState> = { viewMode: m, centerView: 'sessions' };
    if (m === 'tabs' && !get().activeTabSessionId) {
      patch.activeTabSessionId = get().selectedId ?? get().sessions.keys().next().value ?? null;
    }
    set(patch);
  },
  setZoom: (z, panX, panY) => {
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    set({ zoom, ...(panX !== undefined ? { panX } : {}), ...(panY !== undefined ? { panY } : {}) });
  },
  setPan: (x, y) => set({ panX: x, panY: y }),
  requestPanTo: (sessionId) => set({ panRequest: { sessionId, nonce: Date.now() } }),
  patchSessionLocal: (id, patch) => {
    const s = get().sessions.get(id);
    if (!s) return;
    const sessions = new Map(get().sessions);
    sessions.set(id, { ...s, ...patch });
    set({ sessions });
  },

  openFileCard: (path, cwd, at) => {
    // reuse existing card for same path
    for (const c of get().fileCards.values()) {
      if (c.path === path) {
        set({ selectedFileCardId: c.id });
        return;
      }
    }
    const { zoom, panX, panY } = get();
    const id = uid('fc');
    const x = at?.x ?? Math.round((-panX + 120) / zoom + get().fileCards.size * 24);
    const y = at?.y ?? Math.round((-panY + 120) / zoom + get().fileCards.size * 24);
    const fileCards = new Map(get().fileCards);
    // Markdown, JSON and CSV open rendered; the card is larger now that sessions are
    const view = /\.(md|markdown|json|csv|tsv)$/i.test(path);
    fileCards.set(id, { id, path, cwd, mode: view ? 'view' : 'raw', x, y, w: 760, h: 900 });
    set({ fileCards, selectedFileCardId: id, centerView: 'sessions' });
  },
  updateFileCard: (id, patch) => {
    const c = get().fileCards.get(id);
    if (!c) return;
    const fileCards = new Map(get().fileCards);
    fileCards.set(id, { ...c, ...patch });
    set({ fileCards });
  },
  closeFileCard: (id) => {
    const fileCards = new Map(get().fileCards);
    fileCards.delete(id);
    set({ fileCards, ...(get().selectedFileCardId === id ? { selectedFileCardId: null } : {}) });
  },

  openViewerTab: (path) => {
    const existing = get().viewerTabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id, centerView: 'viewer' });
      return;
    }
    const name = path.split(/[\\/]/).pop() || path;
    const tab: ViewerTab = { id: uid('vt'), path, name };
    set({ viewerTabs: [...get().viewerTabs, tab], activeTabId: tab.id, centerView: 'viewer' });
  },
  closeViewerTab: (id) => {
    const tabs = get().viewerTabs.filter((t) => t.id !== id);
    let active = get().activeTabId;
    if (active === id) active = tabs.length ? tabs[tabs.length - 1]!.id : null;
    set({ viewerTabs: tabs, activeTabId: active, ...(tabs.length === 0 ? { centerView: 'sessions' as const } : {}) });
  },
  setActiveTab: (id) => set({ activeTabId: id, ...(id ? { centerView: 'viewer' as const } : {}) }),
  setCenterView: (v) => set({ centerView: v }),
  setFocusMode: (v) => set({ focusMode: v }),
  toggleSidebar: () => set({ sidebarOpen: writeFlag('asm.sidebarOpen', !get().sidebarOpen) }),
  toggleRight: () => set({ rightOpen: writeFlag('asm.rightOpen', !get().rightOpen) }),
  setPanelsDetached: (v) => set({ panelsDetached: v }),
  toggleGroup: (id) => {
    const cur = get().collapsedGroups;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    try {
      localStorage.setItem('asm.collapsedGroups', JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
    set({ collapsedGroups: next });
  },
  setRightTab: (t) => set({ rightTab: t, rightOpen: true }),
  setActivity: (a) => {
    const patch: Partial<AppState> = { activity: a };
    if (a === 'inbox') {
      patch.rightTab = 'inbox';
      patch.rightOpen = true;
    }
    if (a === 'projects') patch.sidebarOpen = true;
    set(patch);
  },
  setTreeFilter: (f) => set({ treeFilter: f }),
  openPalette: (mode) => set({ paletteOpen: true, paletteMode: mode }),
  closePalette: () => set({ paletteOpen: false }),
  openNewSession: (preset) => set({ newSessionOpen: true, newSessionPreset: preset ?? {} }),
  closeNewSession: () => set({ newSessionOpen: false }),
  openImportClaude: (at) => set({ importClaude: at ?? {}, claudeSessions: null }),
  closeImportClaude: () => set({ importClaude: null }),
  openAgents: () => set({ agentsOpen: true }),
  openUsage: () => set({ usageOpen: true }),
  closeUsage: () => set({ usageOpen: false }),
  closeAgents: () => set({ agentsOpen: false }),
  setActiveTabSession: (id) => set({ activeTabSessionId: id }),

  /** Team layout from src/shared/layout.ts (players tall, coaches wide; links run through empty space). */
  autoArrange: () => {
    const sessions = new Map(get().sessions);
    // closed projects keep their layout for when they are opened again
    const projects = get().projects.filter((p) => !p.closed && !get().projects.some((x) => x.id === p.parentId && x.closed));
    for (const [id, r] of arrangeTeam(openSessions(sessions, get().projects), projects)) {
      const cur = sessions.get(id);
      if (cur) sessions.set(id, { ...cur, ...r });
    }
    set({ sessions });
  }
}));

/* ---------- selectors ---------- */

export function unreadCount(state: AppState): number {
  // a closed project's notifications wait until it is opened again
  const closed = closedSessionIds(state.sessions.values(), state.projects);
  return state.inbox.filter((i) => !i.read && !closed.has(i.sessionId)).length;
}


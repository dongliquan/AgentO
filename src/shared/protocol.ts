/**
 * Shared types between daemon, Electron main and renderer.
 * The daemon owns every PTY; the UI is a client that attaches/detaches.
 */

export const DAEMON_PORT_DEFAULT = 47831;

export type AgentKind = 'claude' | 'codex' | 'gemini' | 'ollama' | 'custom' | 'shell';

export type SessionStatus =
  | 'starting'
  | 'working'      // agent is producing output / running tools
  | 'waiting'      // agent finished a turn, waiting for user input
  | 'done'         // agent process exited normally
  | 'error'        // exited with non-zero code or crashed
  | 'hibernated';  // paused by us; can be resumed

export interface AgentDef {
  kind: AgentKind;
  label: string;
  /** executable name or absolute path */
  command: string;
  /** default args when starting a fresh session */
  args: string[];
  /** args template to resume; `{id}` is replaced by resumeId */
  resumeArgs?: string[];
  /** where to find a resumable session id in the output (regex with one group) */
  resumeIdPattern?: string;
  color: string;
}

/**
 * A project (one piece of work, e.g. "Shop") or, when parentId is set, a part of one (planning, development, QA).
 * Head coaches belong to a top-level project; coaches and players to a part (or to a project without parts).
 */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  folders: Folder[];
  /** set for a part: the project it belongs to (one level only) */
  parentId?: string;
  /** closed: its sessions are stopped (resumable) and its routines paused; hidden from the Ground and the tree */
  closed?: boolean;
  /** a top-level project's color (parts use their project's): tags, tree, Ground frame, Orders tab */
  color?: string;
}

/** Project colors, handed out in order to new projects (readable on the light and the dark theme). */
export const PROJECT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0d9488'];

/** Agents › Connections: one agent CLI's install / sign-in state on this PC. */
export interface AgentConnection {
  kind: AgentKind;
  label: string;
  installed: boolean;
  path?: string;
  version?: string;
  /** from the CLI's own sign-in files; null = cannot tell (e.g. macOS keychain) */
  signedIn: boolean | null;
  note?: string;
}

/** A Claude Code session found on disk (~/.claude/projects), e.g. one started in VS Code. */
export interface ClaudeSessionInfo {
  /** Claude session id (the transcript's file name) */
  id: string;
  /** the folder it ran in */
  cwd: string;
  /** its summary, else its first prompt */
  title: string;
  firstPrompt?: string;
  updatedAt: number;
  /** transcript size in bytes */
  size: number;
  /** written to in the last minutes: probably still open elsewhere */
  active: boolean;
  /** already an AgentO session (its title) */
  inAgento?: string;
}

export interface Folder {
  id: string;
  projectId: string;
  path: string;
  name: string;
  /** team sessions started here answer Claude's folder-trust prompt automatically (set by the demo setup) */
  autoTrust?: boolean;
}

/**
 * Team hierarchy (a football club). The user is the manager and gives orders. head: optional head coach over every
 * project · coach: optional per project (or a player promoted to playing coach) · player: does the work.
 * All of them reach the daemon's MCP tools; see src/daemon/team.ts.
 */
export type SessionRole = 'head' | 'coach' | 'player';

/**
 * A repeating order (e.g. the daily stand-up). The daemon sends it on schedule even with no UI open.
 * `{day}` / `{run}` in the text become the run number (1, 2, …).
 */
export interface Routine {
  id: string;
  name: string;
  target: TeamOrderTarget;
  text: string;
  /** every N minutes … */
  everyMinutes?: number;
  /** … or every day at "HH:MM" (local time) */
  dailyAt?: string;
  enabled: boolean;
  nextAt: number;
  runs: number;
  lastRunAt?: number;
  createdAt: number;
}

export type RoutineInput = Pick<Routine, 'name' | 'target' | 'text' | 'everyMinutes' | 'dailyAt' | 'enabled'> & {
  id?: string;
  /** first run right away instead of one period from now */
  runNow?: boolean;
};

/** Who receives an order from the Orders panel. */
export type TeamOrderTarget =
  | { kind: 'all' }                          // every project's head coach (or, without one, each part's lead)
  | { kind: 'project'; projectId: string }   // project: its head coach (or its parts' leads) · part: its coach (or first player)
  | { kind: 'session'; sessionId: string };

export interface Session {
  id: string;
  /** '' for the head coach (it belongs to no project) */
  projectId: string;
  /** '' for the head coach and dedicated coaches (they run in their own team folder); a playing coach keeps its folder */
  folderId: string;
  role: SessionRole;
  cwd: string;
  agent: AgentKind;
  title: string;
  color?: string;
  status: SessionStatus;
  pid?: number;
  resumeId?: string;
  createdAt: number;
  updatedAt: number;
  exitCode?: number;
  /** board layout */
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** its place among its part's sessions (tree order, Ground order); unset = by creation time */
  order?: number;
}

export interface UsageInfo {
  agent: AgentKind;
  /** 0..1 */
  ratio?: number;
  label: string;
  resetsAt?: number;
  warning?: string;
  /** most recently used model id, e.g. "claude-opus-5-5" */
  model?: string;
  /** tokens used in the current usage window (input + output + cache writes) */
  tokens?: number;
}

export interface InboxItem {
  id: string;
  sessionId: string;
  /** directive: an order/instruction sent to this session · report: a report or question between sessions or to the user */
  kind: 'waiting' | 'done' | 'error' | 'directive' | 'report';
  text: string;
  createdAt: number;
  read: boolean;
  /** directive/report: who sent it — a session id, or 'user' (the Ground draws links between sessions from this) */
  fromId?: string;
}

/* ---------- chat transcript (Claude Code JSONL, normalized) ---------- */

export interface ChatTool {
  name: string;
  input: Record<string, unknown>;
  /** plain-text tool result (truncated) */
  result?: string;
  isError?: boolean;
  done: boolean;
  /** unified-diff style lines (' ctx' / '-old' / '+new') for Edit/Write/MultiEdit */
  patch?: string[];
}

export interface ChatEntry {
  /** transcript uuid, or tool_use id for tool entries */
  id: string;
  ts: number;
  kind: 'user' | 'assistant' | 'tool' | 'thinking' | 'system';
  text?: string;
  images?: number;
  tool?: ChatTool;
}

/* ---------- client -> daemon ---------- */

export type ClientMessage =
  | { type: 'hello'; token: string; client: 'ui' | 'cli' }
  | { type: 'project.create'; name: string; parentId?: string } // parentId: create a part of that project
  | { type: 'project.delete'; id: string }
  /** close a top-level project with its parts (stop sessions, pause routines) / open it again */
  | { type: 'project.close'; id: string }
  | { type: 'project.open'; id: string }
  | { type: 'project.setColor'; id: string; color: string }
  | { type: 'project.rename'; id: string; name: string }
  /** Tasks: mark one of the manager's orders (its directive record id) done, or open again */
  | { type: 'order.done'; id: string; done: boolean }
  /** save a project to a file (the daemon answers this client with project.exported) / open a saved one */
  | { type: 'project.export'; id: string }
  | { type: 'project.import'; data: string }
  /** Claude Code sessions under a folder (answer: claude.sessions) / bring picked ones in as players */
  | { type: 'claude.sessions.list'; path: string }
  /** a message from the user for a session that is not running: it is started (resumed) and gets it when ready */
  | { type: 'session.message'; id: string; text: string }
  /** a session just for talking to an agent: in the "Chats" project and its folder (made the first time) */
  | { type: 'chat.new'; agent: AgentKind }
  /** Agents › Connections: re-detect the CLIs and report their install / sign-in state (answer: agents.status) */
  | { type: 'agents.status' }
  /** drag and drop in the tree: into a project / part (another part moves it there), before another session */
  | { type: 'session.move'; id: string; projectId: string; beforeId?: string }
  /** store an image (base64) for an order / message; answered with attachment.saved (same ref) */
  | { type: 'attachment.save'; ref: string; name: string; data: string }
  /**
   * Start a new project from an order: AgentO creates the project, its folders and its head coach, and hands it the
   * brief; the head coach designs the parts and creates the players. plan: report the plan and wait for the go.
   */
  | { type: 'project.start'; name: string; folders: string[]; text: string; plan: boolean }
  /** create the project's head coach if needed and have it organize the sessions into parts with coaches */
  | { type: 'team.organize'; projectId: string }
  | { type: 'claude.sessions.import'; projectId: string; folderId: string; ids: string[]; titles?: Record<string, string> }
  | { type: 'folder.add'; projectId: string; path: string; autoTrust?: boolean }
  | { type: 'folder.remove'; id: string }
  | { type: 'session.create'; projectId: string; folderId: string; agent: AgentKind; title?: string; command?: string; args?: string[]; cols?: number; rows?: number }
  | { type: 'head.create'; projectId?: string }      // one head coach per top-level project
  | { type: 'coach.create'; projectId: string; agent?: 'claude' | 'codex' | 'gemini' } // one coach per project; default claude
  | { type: 'session.setRole'; id: string; role: 'coach' | 'player' } // player ⇄ playing coach
  | { type: 'team.order'; target: TeamOrderTarget; text: string; task?: boolean }      // the user's order; task: added as a task (Tasks › Add Task)
  | { type: 'routine.save'; routine: RoutineInput }   // create (no id) or update
  | { type: 'routine.delete'; id: string }
  | { type: 'routine.run'; id: string }               // run now (counts as a run)
  | { type: 'session.input'; id: string; data: string }
  | { type: 'session.resize'; id: string; cols: number; rows: number }
  | { type: 'session.attach'; id: string }          // request scrollback replay
  | { type: 'chat.subscribe'; id: string }          // request full chat transcript snapshot
  | { type: 'session.stop'; id: string }            // send SIGINT / Ctrl+C
  | { type: 'session.kill'; id: string }
  | { type: 'session.restart'; id: string }
  | { type: 'session.resume'; id: string }
  | { type: 'session.hibernate'; id: string }
  | { type: 'session.update'; id: string; patch: Partial<Pick<Session, 'title' | 'color' | 'x' | 'y' | 'w' | 'h'>> }
  | { type: 'session.remove'; id: string }
  | { type: 'inbox.read'; id: string }
  | { type: 'fs.list'; path: string }
  /** file names under the open projects' folders (Quick Open); answered with fs.search.result (same ref) */
  | { type: 'fs.search'; ref: string; query: string }
  | { type: 'fs.read'; path: string }
  | { type: 'fs.changed'; cwd: string }             // git status --porcelain
  | { type: 'usage.refresh' }
  | { type: 'daemon.shutdown'; killSessions: boolean };

/* ---------- daemon -> client ---------- */

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  gitStatus?: 'M' | 'A' | 'D' | '?' | 'R';
}

export type ServerMessage =
  | { type: 'welcome'; daemonPid: number; version: string; projects: Project[]; sessions: Session[]; inbox: InboxItem[]; usage: UsageInfo[]; agents: AgentDef[]; routines: Routine[]; doneOrders: Record<string, number>; taskOrders: string[] }
  /** Tasks: the manager's orders marked done (order record id → when) and the ones added as tasks explicitly */
  | { type: 'orders.done'; done: Record<string, number>; tasks: string[] }
  | { type: 'routines'; routines: Routine[] }
  /** answer to project.export: the .agento file contents */
  | { type: 'project.exported'; name: string; data: string }
  | { type: 'claude.sessions'; path: string; items: ClaudeSessionInfo[] }
  | { type: 'attachment.saved'; ref: string; path: string }
  | { type: 'agents.status'; items: AgentConnection[] }
  /** answer to chat.new: the new session (the asking window opens it) */
  | { type: 'chat.created'; id: string }
  | { type: 'fs.search.result'; ref: string; items: { path: string; root: string }[] }
  /** a team message was just typed into this session (the card replays it in its message box) */
  | { type: 'team.delivered'; sessionId: string; text: string }
  | { type: 'projects'; projects: Project[] }
  | { type: 'session.upsert'; session: Session }
  | { type: 'session.removed'; id: string }
  | { type: 'session.data'; id: string; data: string }
  | { type: 'session.scrollback'; id: string; data: string }
  | { type: 'chat.snapshot'; id: string; entries: ChatEntry[]; available: boolean }
  | { type: 'chat.upsert'; id: string; entries: ChatEntry[] }
  | { type: 'inbox'; items: InboxItem[] }
  | { type: 'usage'; usage: UsageInfo[] }
  | { type: 'fs.list.result'; path: string; entries: FsEntry[] }
  | { type: 'fs.read.result'; path: string; content: string; truncated: boolean }
  | { type: 'fs.changed.result'; cwd: string; entries: FsEntry[] }
  | { type: 'error'; message: string; ref?: string };

/* ---------- Electron preload bridge ---------- */

/** One entry of the application menu, serialized for the renderer's menu bar. */
export interface MenuNode {
  label: string;
  type: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  enabled: boolean;
  checked?: boolean;
  /** display form, e.g. "Ctrl+Shift+N" */
  accelerator?: string;
  items?: MenuNode[];
}

export interface DesktopApi {
  /** returns { port, token } once daemon is reachable */
  getDaemonInfo(): Promise<{ port: number; token: string }>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  openInVsCode(path: string): Promise<void>;
  openExternalTerminal(path: string): Promise<void>;
  /** Agents › Connections: open a terminal window that installs an agent CLI or signs in to it (fixed commands) */
  agentTerminal(kind: 'claude' | 'codex' | 'gemini', action: 'install' | 'login'): Promise<void>;
  onMenu(cb: (command: string) => void): () => void;
  notify(title: string, body: string, sessionId?: string): void;
  /** top-level labels of the application menu (for the in-app title bar) */
  menuLabels(): Promise<string[]>;
  /** pop up the submenu of a top-level menu at window coordinates */
  popupMenu(label: string, x: number, y: number): void;
  /** the application menu as data, for the in-app (HTML) menu bar */
  menuTree(): Promise<MenuNode[]>;
  /** run the menu item at this index path (e.g. [3, 0, 2]) */
  menuClick(path: number[]): void;
  /** recolor the native window-control overlay (Windows/Linux) */
  setTitleBarColors(color: string, symbolColor: string): void;
  platform: NodeJS.Platform;
}

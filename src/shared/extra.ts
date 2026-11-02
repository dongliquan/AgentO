/**
 * Additions to the shared protocol that do not change protocol.ts.
 * The renderer may ignore any extra field carried here.
 */
import type { AgentDef } from './protocol';

/** An `agento://dispatch` request from another app (ReadO's Commit / Push), checked by the main process. */
export interface DispatchRequest {
  id: string;
  kind: 'commit' | 'push';
  /** absolute path of the repository */
  repo: string;
  branch?: string;
  /** commits ahead of the remote (push) */
  ahead?: number;
  /** number of changed files (commit) */
  files?: number;
  /** a short commit message draft */
  msg?: string;
  /** the changed files, from the request's ref file */
  fileList?: string[];
  /** the sending app, e.g. "ReadO" */
  from: string;
  url: string;
}

/** AgentDef plus a best-effort "is the command installed on this machine" flag. */
export type AgentDefEx = AgentDef & { available?: boolean };

/** Shape of <dataDir>/daemon.json. */
export interface DaemonInfoFile {
  port: number;
  token: string;
  pid: number;
  version: string;
}

/**
 * Every command id the application menu can emit via `webContents.send('menu', id)`.
 * The renderer subscribes with `window.desktop.onMenu(cb)`.
 */
export const MENU_COMMANDS = [
  // File
  'project.new',
  'project.import',
  'project.export',
  'web.gemini',
  'web.chatgpt',
  'session.new-chat.codex',
  'session.new-chat.claude',
  'session.import-claude',
  'project.add-folder',
  'session.new',
  'session.close',
  'app.settings',
  'window.hide',
  'app.quit-keep',
  'app.quit-all',
  // Edit
  'edit.find',
  'terminal.find',
  'terminal.clear',
  'session.rename',
  // View
  'view.board',
  'view.split',
  'view.tabs',
  'view.zoom-in',
  'view.zoom-out',
  'view.zoom-reset',
  'view.zoom-fit',
  'view.sidebar',
  'view.right-panel',
  'view.inbox',
  'view.focus-mode',
  'view.minimap',
  'view.timeline',
  'view.today',
  'view.fullscreen',
  'view.theme.light',
  'view.theme.dark',
  // Session
  'session.new.claude',
  'session.new.codex',
  'session.new.gemini',
  'session.new.ollama',
  'session.new.shell',
  'session.restart',
  'session.resume',
  'session.hibernate',
  'session.stop',
  'session.kill',
  'session.duplicate',
  'session.open-folder',
  'session.open-vscode',
  'session.open-terminal',
  'session.export',
  'session.open-log',
  // Agents
  'agents.settings',
  'agents.detect',
  'agents.login-status',
  // Go
  'go.palette',
  'go.quick-open',
  'go.next-session',
  'go.prev-session',
  'go.waiting-session',
  // Window
  'window.always-on-top',
  // Help
  'help.docs',
  'help.shortcuts',
  'help.check-update',
  'help.daemon-log',
  'help.daemon-restart',
  'help.about'
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

/** Payload of the 'focus-session' event the main process sends when a notification is clicked. */
export interface FocusSessionEvent {
  sessionId: string;
  /** a command to run instead of revealing the session (e.g. 'view.orders' for a report) */
  command?: string;
}

/**
 * Renderer role. 'panels' is the detachable window that shows the left sidebar and the right panel side by side
 * (a status board); 'main' is the board window; 'viewer' is a window showing one file (`--agento-file=<path>`).
 * Passed to the preload as `--agento-role=<role>`.
 */
export type WindowRole = 'main' | 'panels' | 'viewer';

/** Messages the main process forwards between the main window and the panels window. */
export type PanelsRelay =
  /** panels → main: select the session and pan the board to it (focus: also focus its terminal) */
  | { kind: 'reveal'; sessionId: string; focus?: boolean }
  /** main → panels: the board selection changed */
  | { kind: 'select'; sessionId: string | null }
  /** main → panels: show a file in the Files tab (a file link clicked in the main window's chat) */
  | { kind: 'revealFile'; path: string }
  /** run a palette/menu command id in the other window (panels → main; main → panels for view.orders) */
  | { kind: 'command'; id: string };

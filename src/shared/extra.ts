/**
 * Additions to the shared protocol that do not change protocol.ts.
 * The renderer may ignore any extra field carried here.
 */
import type { AgentDef } from './protocol';

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
  'session.import-claude',
  'project.add-folder',
  'session.new',
  'session.close',
  'app.settings',
  'window.hide',
  'app.quit-keep',
  'app.quit-all',
  // Edit
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
  'view.fullscreen',
  'view.theme.light',
  'view.theme.dark',
  'view.theme.system',
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
  'agents.install-claude-hooks',
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
}

/**
 * Renderer role. 'panels' is the detachable window that shows the left sidebar and the right panel side by side
 * (a status board); 'main' is the board window. Passed to the preload as `--agento-role=<role>`.
 */
export type WindowRole = 'main' | 'panels';

/** Messages the main process forwards between the main window and the panels window. */
export type PanelsRelay =
  /** panels → main: select the session and pan the board to it (focus: also focus its terminal) */
  | { kind: 'reveal'; sessionId: string; focus?: boolean }
  /** main → panels: the board selection changed */
  | { kind: 'select'; sessionId: string | null }
  /** panels → main */
  | { kind: 'openFileCard'; path: string; cwd: string }
  | { kind: 'openViewerTab'; path: string }
  /** run a palette/menu command id in the other window (panels → main; main → panels for view.orders) */
  | { kind: 'command'; id: string };

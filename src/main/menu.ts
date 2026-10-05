/**
 * Application menu. Every custom item sends `webContents.send('menu', <command id>)`.
 */
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '@shared/extra';

export interface MenuActions {
  getWindow: () => BrowserWindow | null;
  showWindow: () => void;
  hideWindow: () => void;
  quitKeep: () => void;
  quitAll: () => void;
  restartDaemon: () => void;
  openDaemonLog: () => void;
  togglePanelsWindow: () => void;
}

export function buildMenu(actions: MenuActions): Menu {
  const send = (id: MenuCommand): void => {
    const win = actions.getWindow();
    if (!win || win.isDestroyed()) return;
    actions.showWindow();
    win.webContents.send('menu', id);
  };
  const item = (
    label: string,
    id: MenuCommand,
    accelerator?: string,
    extra: Partial<MenuItemConstructorOptions> = {}
  ): MenuItemConstructorOptions => {
    const o: MenuItemConstructorOptions = { label, click: () => send(id), ...extra };
    if (accelerator) o.accelerator = accelerator;
    return o;
  };
  /** item that both notifies the renderer and runs a main-process action */
  const both = (label: string, id: MenuCommand, action: () => void, accelerator?: string): MenuItemConstructorOptions => {
    const o: MenuItemConstructorOptions = {
      label,
      click: () => {
        const win = actions.getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('menu', id);
        action();
      }
    };
    if (accelerator) o.accelerator = accelerator;
    return o;
  };
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const isMac = process.platform === 'darwin';

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      item('New Project', 'project.new', 'CmdOrCtrl+Shift+N'),
      item('Open Project File…', 'project.import', 'CmdOrCtrl+O'),
      item('Save Project As…', 'project.export', 'CmdOrCtrl+Shift+S'),
      item('Add Folder to Project', 'project.add-folder'),
      sep,
      item('New Session', 'session.new', 'CmdOrCtrl+N'),
      item('Import Claude Code Sessions…', 'session.import-claude'),
      // Delete (handled in the renderer, not while typing) — no menu accelerator, it would catch Delete in the terminal
      item('Remove Session…', 'session.close'),
      sep,
      item('Settings', 'app.settings', 'CmdOrCtrl+,'),
      sep,
      both('Quit (Keep Sessions)', 'app.quit-keep', actions.quitKeep),
      both('Stop All Sessions and Quit', 'app.quit-all', actions.quitAll)
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo', label: 'Undo' },
      { role: 'redo', label: 'Redo' },
      sep,
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { role: 'selectAll', label: 'Select All' },
      sep,
      item('Find in Terminal', 'terminal.find', 'CmdOrCtrl+F'),
      item('Clear Terminal', 'terminal.clear', 'CmdOrCtrl+K'),
      sep,
      item('Rename Session', 'session.rename', 'F2')
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      item('Ground', 'view.board', 'CmdOrCtrl+1'),
      item('Split View', 'view.split', 'CmdOrCtrl+2'),
      item('Tab View', 'view.tabs', 'CmdOrCtrl+3'),
      sep,
      item('Zoom In', 'view.zoom-in', 'CmdOrCtrl+='),
      item('Zoom Out', 'view.zoom-out', 'CmdOrCtrl+-'),
      item('100%', 'view.zoom-reset', 'CmdOrCtrl+0'),
      item('Fit All', 'view.zoom-fit', 'CmdOrCtrl+Shift+0'),
      sep,
      item('Sidebar', 'view.sidebar', 'CmdOrCtrl+B'),
      item('Right Panel', 'view.right-panel', 'CmdOrCtrl+Shift+E'),
      item('Inbox', 'view.inbox', 'CmdOrCtrl+Shift+I'),
      sep,
      item('Focus Mode', 'view.focus-mode', 'F11'),
      sep,
      {
        label: 'Theme',
        submenu: [
          item('Light', 'view.theme.light'),
          item('Dark', 'view.theme.dark'),
          item('System', 'view.theme.system')
        ]
      }
    ]
  };

  const sessionMenu: MenuItemConstructorOptions = {
    label: 'Session',
    submenu: [
      {
        // a session just to talk to an agent (kept in the "Chats" project)
        label: 'New Chat',
        submenu: [item('ChatGPT (Codex)', 'session.new-chat.codex'), item('Claude', 'session.new-chat.claude')]
      },
      {
        label: 'New Session',
        submenu: [
          item('Claude Code', 'session.new.claude'),
          item('Codex', 'session.new.codex'),
          item('Gemini CLI', 'session.new.gemini'),
          item('Ollama', 'session.new.ollama'),
          item('Shell', 'session.new.shell')
        ]
      },
      sep,
      item('Restart', 'session.restart'),
      item('Resume', 'session.resume'),
      item('Hibernate', 'session.hibernate'),
      item('Stop', 'session.stop'),
      item('Kill', 'session.kill'),
      sep,
      item('Duplicate', 'session.duplicate'),
      item('Rename', 'session.rename'),
      sep,
      item(isMac ? 'Reveal Working Folder in Finder' : 'Reveal Working Folder in Explorer', 'session.open-folder'),
      item('Open in VS Code', 'session.open-vscode'),
      item('Open in External Terminal', 'session.open-terminal'),
      sep,
      item('Export Conversation', 'session.export'),
      item('Open Session Log', 'session.open-log')
    ]
  };

  const agentsMenu: MenuItemConstructorOptions = {
    label: 'Agents',
    submenu: [
      item('Connections… (Claude, ChatGPT, Gemini)', 'agents.settings'),
      item('Re-run Auto Detection', 'agents.detect'),
      sep,
      item('Check Sign-in', 'agents.login-status')
    ]
  };

  const goMenu: MenuItemConstructorOptions = {
    label: 'Go',
    submenu: [
      item('Command Palette', 'go.palette', 'CmdOrCtrl+Shift+P'),
      item('Quick Open', 'go.quick-open', 'CmdOrCtrl+P'),
      item('Next Session', 'go.next-session', 'Ctrl+Tab'),
      item('Previous Session', 'go.prev-session', 'Ctrl+Shift+Tab'),
      item('Go to Waiting Session', 'go.waiting-session', 'CmdOrCtrl+Shift+W')
    ]
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: 'Minimize' },
      {
        label: 'Maximize / Restore',
        click: () => {
          const win = actions.getWindow();
          if (!win || win.isDestroyed()) return;
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
        }
      },
      {
        label: 'Full Screen',
        accelerator: isMac ? 'Ctrl+Cmd+F' : 'Shift+F11',
        click: () => {
          const win = actions.getWindow();
          if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
          send('view.fullscreen');
        }
      },
      // Zoom / Bring All to Front only do something on macOS
      ...(isMac ? [{ role: 'zoom', label: 'Zoom' } as MenuItemConstructorOptions] : []),
      sep,
      { label: 'Panels in Separate Window', accelerator: 'CmdOrCtrl+Shift+B', click: () => actions.togglePanelsWindow() },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: actions.getWindow()?.isAlwaysOnTop() ?? false,
        click: (mi) => {
          const win = actions.getWindow();
          if (win && !win.isDestroyed()) win.setAlwaysOnTop(mi.checked);
          send('window.always-on-top');
        }
      },
      ...(isMac ? [{ role: 'front', label: 'Bring All to Front' } as MenuItemConstructorOptions] : []),
      sep,
      both('Close Window (to Tray)', 'window.hide', actions.hideWindow)
    ]
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      item('Documentation', 'help.docs'),
      item('Keyboard Shortcuts', 'help.shortcuts'),
      item('Check for Updates', 'help.check-update'),
      both('Open Daemon Log', 'help.daemon-log', actions.openDaemonLog),
      both('Restart Daemon', 'help.daemon-restart', actions.restartDaemon),
      sep,
      item('About', 'help.about')
    ]
  };

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        sep,
        item('Settings', 'app.settings', 'CmdOrCtrl+,'),
        sep,
        { role: 'services', label: 'Services' },
        sep,
        { role: 'hide', label: `Hide ${app.name}` },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        sep,
        both('Quit (Keep Sessions)', 'app.quit-keep', actions.quitKeep, 'Cmd+Q'),
        both('Stop All Sessions and Quit', 'app.quit-all', actions.quitAll)
      ]
    });
  }
  template.push(fileMenu, editMenu, viewMenu, sessionMenu, agentsMenu, goMenu, windowMenu, helpMenu);
  return Menu.buildFromTemplate(template);
}

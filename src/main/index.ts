import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, type Tray } from 'electron';
import { buildMenu } from './menu';
import { createTray } from './tray';
import {
  daemonLogPath,
  ensureDaemon,
  probeDaemon,
  readDaemonInfo,
  shutdownDaemon,
  spawnDaemon
} from './daemon-launcher';
import type { FocusSessionEvent, PanelsRelay } from '@shared/extra';
import type { MenuNode } from '@shared/protocol';

/** Windows AppUserModelId (taskbar grouping/icon). Declared before bootstrap() runs below. */
const APP_ID = 'app.agento.desktop';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/* ---------- single instance ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  void bootstrap();
}

function getWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function showWindow(): void {
  const win = getWindow();
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function hideWindow(): void {
  const win = getWindow();
  if (!win) return;
  win.hide();
  if (process.platform === 'darwin') app.dock?.hide();
}

function quitKeep(): void {
  isQuitting = true;
  app.quit();
}

async function quitAll(): Promise<void> {
  isQuitting = true;
  try {
    await shutdownDaemon(true);
  } catch {
    /* ignore */
  }
  app.quit();
}

async function restartDaemon(): Promise<void> {
  try {
    await shutdownDaemon(false);
  } catch {
    /* ignore */
  }
  // wait for daemon.json to disappear (up to 3 s), then relaunch
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && readDaemonInfo()) await new Promise((r) => setTimeout(r, 100));
  try {
    await ensureDaemon();
    getWindow()?.webContents.send('daemon-restarted');
  } catch (e) {
    dialog.showErrorBox('Failed to Restart Daemon', e instanceof Error ? e.message : String(e));
  }
}

function openDaemonLog(): void {
  const p = daemonLogPath();
  if (!fs.existsSync(p)) fs.writeFileSync(p, '');
  void shell.openPath(p);
}

/* ---------- window ---------- */

/** Packaged: resources/; dev: <project>/build (app path, or relative to out/main when the app path is elsewhere). */
function iconFile(ext: 'png' | 'ico'): string | undefined {
  const name = `icon.${ext}`;
  const candidates = [
    path.join(process.resourcesPath ?? '', name),
    path.join(app.getAppPath(), 'build', name),
    path.join(__dirname, '../../build', name)
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/** Windows wants the multi-size .ico (16–256 px); elsewhere the png. */
function windowIcon(): string | undefined {
  return (process.platform === 'win32' ? iconFile('ico') : undefined) ?? iconFile('png');
}

/**
 * Windows groups taskbar buttons by AppUserModelId and, for an id without a Start-menu shortcut (every dev run),
 * shows the executable's icon — Electron's — instead of the window icon. Give each window the id plus an explicit
 * relaunch icon so the taskbar shows AgentO's.
 */
function applyTaskbarIdentity(win: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const icon = app.isPackaged ? process.execPath : iconFile('ico');
  const relaunchCommand = app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
  win.setAppDetails({
    appId: APP_ID,
    relaunchCommand,
    relaunchDisplayName: 'AgentO',
    ...(icon ? { appIconPath: icon, appIconIndex: 0 } : {})
  });
}

/**
 * Windows toasts show the app's name and icon from its Start-menu shortcut; without one (every dev run) the header is
 * the raw AppUserModelId. Registering the id under HKCU\Software\Classes\AppUserModelId gives it "AgentO" and the
 * icon — per user, no admin rights.
 */
function registerToastIdentity(): void {
  if (process.platform !== 'win32') return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
  const set = (name: string, value: string): void => {
    spawnSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true });
  };
  set('DisplayName', 'AgentO');
  const png = iconFile('png');
  if (png) set('IconUri', png);
}

/** Keep in sync with --topbar-h in styles.css (overlay is 1px shorter so the bar's bottom border stays visible). */
const TITLEBAR_H = 36;
let appMenu: Menu | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#ffffff',
    icon: windowIcon(),
    // One-row custom title bar (icon · menu · search) drawn by the renderer; native window controls overlay it.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: { color: '#ffffff', symbolColor: '#1f2328', height: TITLEBAR_H - 1 } }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  mainWindow = win;
  applyTaskbarIdentity(win);

  win.once('ready-to-show', () => {
    win.show();
    if (process.platform === 'darwin') void app.dock?.show();
  });

  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hideWindow();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  loadRenderer(win);
  return win;
}

function loadRenderer(win: BrowserWindow): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

/* ---------- panels window (left sidebar + right panel, detached) ---------- */

let panelsWindow: BrowserWindow | null = null;
/** last bounds of the panels window during this run, so reopening puts it back where it was */
let panelsBounds: Electron.Rectangle | null = null;

function getPanelsWindow(): BrowserWindow | null {
  return panelsWindow && !panelsWindow.isDestroyed() ? panelsWindow : null;
}

function sendPanelsState(): void {
  getWindow()?.webContents.send('panels.state', getPanelsWindow() !== null);
}

function togglePanelsWindow(): void {
  const existing = getPanelsWindow();
  if (existing) {
    existing.close();
    return;
  }
  const win = new BrowserWindow({
    width: panelsBounds?.width ?? 720,
    height: panelsBounds?.height ?? 820,
    ...(panelsBounds ? { x: panelsBounds.x, y: panelsBounds.y } : {}),
    minWidth: 520,
    minHeight: 420,
    title: 'AgentO Panels',
    backgroundColor: '#ffffff',
    icon: windowIcon(),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: { color: '#ffffff', symbolColor: '#1f2328', height: TITLEBAR_H - 1 } }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      additionalArguments: ['--agento-role=panels']
    }
  });
  panelsWindow = win;
  applyTaskbarIdentity(win);
  // No application menu here: its accelerators would act on the main window; PanelsApp handles its own keys.
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    panelsBounds = win.getBounds();
  });
  win.on('closed', () => {
    if (panelsWindow === win) panelsWindow = null;
    sendPanelsState();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  loadRenderer(win);
  sendPanelsState();
}

/** Forwards a PanelsRelay to the other window; brings the main window up when the panels window acts on it. */
function relayPanels(from: Electron.WebContents, msg: PanelsRelay): void {
  const main = getWindow();
  const panels = getPanelsWindow();
  if (panels && from === panels.webContents) {
    if (!main) return;
    if (main.isMinimized()) main.restore();
    if (!main.isVisible()) main.showInactive();
    if ((msg.kind === 'reveal' && msg.focus) || msg.kind === 'command') main.focus();
    main.webContents.send('panels.relay', msg);
  } else if (panels) {
    panels.webContents.send('panels.relay', msg);
  }
}

/** "CmdOrCtrl+Shift+N" → "Ctrl+Shift+N" (⌘ on macOS). */
function displayAccelerator(acc: string | undefined): string | undefined {
  if (!acc) return undefined;
  const mac = process.platform === 'darwin';
  return acc.replace(/CmdOrCtrl|CommandOrControl/g, mac ? '⌘' : 'Ctrl').replace(/\bCmd\b|\bCommand\b/g, '⌘');
}

function serializeMenu(menu: Menu | null): MenuNode[] {
  const walk = (items: Electron.MenuItem[]): MenuNode[] =>
    items
      .filter((i) => i.visible !== false)
      .map((i) => {
        const type: MenuNode['type'] = i.type === 'separator' ? 'separator' : i.submenu ? 'submenu' : i.type === 'checkbox' || i.type === 'radio' ? i.type : 'normal';
        const node: MenuNode = { label: i.label, type, enabled: i.enabled };
        if (type === 'checkbox' || type === 'radio') node.checked = i.checked;
        const acc = displayAccelerator(typeof i.accelerator === 'string' ? i.accelerator : undefined);
        if (acc) node.accelerator = acc;
        if (i.submenu) node.items = walk(i.submenu.items);
        return node;
      });
  return walk(menu?.items ?? []);
}

/* ---------- IPC (DesktopApi) ---------- */

function registerIpc(): void {
  // In-app title bar menu: the renderer draws the top-level labels, main pops the native submenu.
  ipcMain.handle('menu.labels', () => (appMenu?.items ?? []).filter((i) => i.visible !== false && i.submenu).map((i) => i.label));
  // HTML menu bar: the menu as data, and running an item by its index path (roles and checkboxes behave as native)
  ipcMain.handle('menu.tree', () => serializeMenu(appMenu));
  ipcMain.on('menu.click', (e, path: number[]) => {
    let items = appMenu?.items ?? [];
    let item: Electron.MenuItem | undefined;
    for (const i of path) {
      item = items.filter((x) => x.visible !== false)[i];
      items = item?.submenu?.items ?? [];
    }
    if (!item || !item.enabled) return;
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    item.click(undefined, win, e.sender);
  });
  ipcMain.on('menu.popup', (_e, label: string, x: number, y: number) => {
    const win = getWindow();
    const item = appMenu?.items.find((i) => i.label === label);
    if (win && item?.submenu) item.submenu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
  });
  ipcMain.on('titlebar.colors', (e, color: string, symbolColor: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed() && process.platform !== 'darwin') win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_H - 1 });
  });

  ipcMain.on('panels.toggle', () => togglePanelsWindow());
  ipcMain.handle('panels.isOpen', () => getPanelsWindow() !== null);
  ipcMain.on('panels.relay', (e, msg: PanelsRelay) => relayPanels(e.sender, msg));

  ipcMain.handle('daemon.info', async () => {
    const info = readDaemonInfo();
    if (info && (await probeDaemon(info.port, info.token, 800))) return { port: info.port, token: info.token };
    const fresh = await ensureDaemon();
    return { port: fresh.port, token: fresh.token };
  });

  ipcMain.handle('dialog.pickFolder', async () => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], title: 'Select Folder' };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle('shell.openPath', async (_e, p: string) => {
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  });

  ipcMain.handle('shell.openVsCode', async (_e, p: string) => {
    if (process.platform === 'win32') {
      const child = spawn('code.cmd', [p], { detached: true, stdio: 'ignore', shell: true, windowsHide: true });
      child.on('error', () => {
        /* reported below via fallback */
      });
      child.unref();
    } else {
      const child = spawn('code', [p], { detached: true, stdio: 'ignore' });
      child.on('error', () => {
        // `code` not on PATH: try the macOS app bundle
        if (process.platform === 'darwin') {
          const alt = spawn('open', ['-a', 'Visual Studio Code', p], { detached: true, stdio: 'ignore' });
          alt.on('error', () => {
            /* give up silently */
          });
          alt.unref();
        }
      });
      child.unref();
    }
  });

  // Agents › Connections: install / sign in, each in its own terminal window. The commands are fixed here — the
  // renderer only names the agent and the action.
  ipcMain.handle('agents.terminal', async (_e, kind: string, action: string) => {
    const win32 = process.platform === 'win32';
    const commands: Record<string, Record<string, string>> = {
      claude: {
        install: win32
          ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"'
          : 'curl -fsSL https://claude.ai/install.sh | bash',
        login: 'claude'
      },
      codex: { install: 'npm install -g @openai/codex', login: 'codex login' },
      gemini: { install: 'npm install -g @google/gemini-cli', login: 'gemini' }
    };
    const command = commands[kind]?.[action];
    if (!command) throw new Error('Unknown agent action');
    const title = `AgentO · ${kind} ${action}`;
    // a clean environment for the CLI (Electron's run-as-node flag must not leak into it)
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '' };
    let child;
    if (win32) {
      child = spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd', '/k', command], { detached: true, stdio: 'ignore', windowsHide: false, env, cwd: os.homedir(), shell: false, windowsVerbatimArguments: true });
    } else if (process.platform === 'darwin') {
      child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore', env });
    } else {
      child = spawn(process.env['TERMINAL'] || 'x-terminal-emulator', ['-e', 'bash', '-lc', `${command}; exec bash`], { detached: true, stdio: 'ignore', env, cwd: os.homedir() });
    }
    child.on('error', () => {
      /* no terminal: nothing to show */
    });
    child.unref();
  });

  ipcMain.handle('shell.openTerminal', async (_e, p: string) => {
    if (process.platform === 'win32') {
      const wt = spawn('wt.exe', ['-d', p], { detached: true, stdio: 'ignore', windowsHide: false });
      wt.on('error', () => {
        const cmd = spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', 'cd', '/d', p], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        cmd.on('error', () => {
          /* ignore */
        });
        cmd.unref();
      });
      wt.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', ['-a', 'Terminal', p], { detached: true, stdio: 'ignore' });
      child.on('error', () => {
        /* ignore */
      });
      child.unref();
    } else {
      const term = process.env['TERMINAL'] || 'x-terminal-emulator';
      const child = spawn(term, [], { cwd: p, detached: true, stdio: 'ignore' });
      child.on('error', () => {
        /* ignore */
      });
      child.unref();
    }
  });

  ipcMain.on('notify', (_e, title: string, body: string, sessionId?: string) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      showWindow();
      if (sessionId) {
        const payload: FocusSessionEvent = { sessionId };
        getWindow()?.webContents.send('focus-session', payload);
      }
    });
    n.show();
  });
}

/* ---------- bootstrap ---------- */

async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  registerToastIdentity();

  await app.whenReady();
  registerIpc();

  try {
    await ensureDaemon();
  } catch (e) {
    dialog.showErrorBox('Failed to Start Daemon', e instanceof Error ? e.message : String(e));
    // Keep the UI alive anyway; the renderer can retry through daemon.info.
    spawnDaemon();
  }

  appMenu = buildMenu({
      getWindow,
      showWindow,
      hideWindow,
      quitKeep,
      quitAll: () => void quitAll(),
      restartDaemon: () => void restartDaemon(),
      openDaemonLog,
      togglePanelsWindow
  });
  Menu.setApplicationMenu(appMenu);
  tray = createTray({ showWindow, quitKeep, quitAll: () => void quitAll() });
  createWindow();

  app.on('activate', () => showWindow());
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('window-all-closed', () => {
    // Window is hidden to tray instead of closed; only quit when explicitly asked.
    if (isQuitting) app.quit();
  });
  app.on('will-quit', () => {
    tray?.destroy();
    tray = null;
  });
}

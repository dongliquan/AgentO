import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, MenuNode } from '@shared/protocol';
import type { DispatchRequest, PanelsRelay, WindowRole } from '@shared/extra';

const desktop: DesktopApi = {
  getDaemonInfo: () => ipcRenderer.invoke('daemon.info') as Promise<{ port: number; token: string }>,
  pickFolder: () => ipcRenderer.invoke('dialog.pickFolder') as Promise<string | null>,
  openPath: (p: string) => ipcRenderer.invoke('shell.openPath', p) as Promise<void>,
  openInVsCode: (p: string) => ipcRenderer.invoke('shell.openVsCode', p) as Promise<void>,
  openExternalTerminal: (p: string) => ipcRenderer.invoke('shell.openTerminal', p) as Promise<void>,
  openUrl: (url: string) => ipcRenderer.invoke('shell.openUrl', url) as Promise<void>,
  openFileWindow: (p: string) => ipcRenderer.send('file.openWindow', p),
  openInReadO: (p: string) => ipcRenderer.invoke('file.openInReadO', p) as Promise<string | null>,
  find: (text: string, forward: boolean, next: boolean) => ipcRenderer.send('find.start', text, forward, next),
  stopFind: () => ipcRenderer.send('find.stop'),
  fileDataUrl: (p: string) => ipcRenderer.invoke('file.dataUrl', p) as Promise<string | null>,
  webFavicon: (url: string) => ipcRenderer.invoke('web.favicon', url) as Promise<string | null>,
  agentTerminal: (kind, action) => ipcRenderer.invoke('agents.terminal', kind, action) as Promise<void>,
  onMenu: (cb: (command: string) => void) => {
    const listener = (_e: IpcRendererEvent, command: string) => cb(command);
    ipcRenderer.on('menu', listener);
    return () => {
      ipcRenderer.removeListener('menu', listener);
    };
  },
  notify: (title: string, body: string, sessionId?: string, command?: string) => {
    ipcRenderer.send('notify', title, body, sessionId, command);
  },
  menuLabels: () => ipcRenderer.invoke('menu.labels') as Promise<string[]>,
  popupMenu: (label: string, x: number, y: number) => ipcRenderer.send('menu.popup', label, x, y),
  menuTree: () => ipcRenderer.invoke('menu.tree') as Promise<MenuNode[]>,
  menuClick: (path: number[]) => ipcRenderer.send('menu.click', path),
  setTitleBarColors: (color: string, symbolColor: string) => ipcRenderer.send('titlebar.colors', color, symbolColor),
  setTheme: (pref) => ipcRenderer.send('theme.set', pref),
  getTheme: () => ipcRenderer.sendSync('theme.get') as 'light' | 'dark' | 'system' | null,
  onThemeChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, pref: 'light' | 'dark' | 'system') => cb(pref);
    ipcRenderer.on('theme.changed', listener);
    return () => {
      ipcRenderer.removeListener('theme.changed', listener);
    };
  },
  platform: process.platform
};

/** Extra events beyond DesktopApi (renderer may ignore): 'focus-session' ({ sessionId }), 'daemon-restarted'. */
const desktopEvents = {
  onFocusSession: (cb: (sessionId: string, command?: string) => void) => {
    const listener = (_e: IpcRendererEvent, payload: { sessionId: string; command?: string }) => cb(payload.sessionId, payload.command);
    ipcRenderer.on('focus-session', listener);
    return () => {
      ipcRenderer.removeListener('focus-session', listener);
    };
  },
  onDaemonRestarted: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('daemon-restarted', listener);
    return () => {
      ipcRenderer.removeListener('daemon-restarted', listener);
    };
  },
  /** agento:// requests (and rejected ones); subscribing tells the main process this page listens */
  onDispatch: (cb: (req: DispatchRequest) => void, onError: (err: { error: string; url: string }) => void) => {
    const a = (_e: IpcRendererEvent, req: DispatchRequest) => cb(req);
    const b = (_e: IpcRendererEvent, err: { error: string; url: string }) => onError(err);
    ipcRenderer.on('dispatch', a);
    ipcRenderer.on('dispatch.error', b);
    ipcRenderer.send('dispatch.ready');
    return () => {
      ipcRenderer.removeListener('dispatch', a);
      ipcRenderer.removeListener('dispatch.error', b);
    };
  },
  /** find-in-page results: matches and which one is selected (1-based) */
  onFindResult: (cb: (r: { matches: number; active: number }) => void) => {
    const listener = (_e: IpcRendererEvent, r: { matches: number; active: number }) => cb(r);
    ipcRenderer.on('find.result', listener);
    return () => {
      ipcRenderer.removeListener('find.result', listener);
    };
  }
};

const roleArg = process.argv.find((a) => a.startsWith('--agento-role='));
const roleName = roleArg?.slice('--agento-role='.length);
const role: WindowRole = roleName === 'panels' || roleName === 'viewer' ? roleName : 'main';
const fileArg = process.argv.find((a) => a.startsWith('--agento-file='));

const panels = {
  role,
  file: fileArg ? fileArg.slice('--agento-file='.length) : undefined,

  toggle: () => ipcRenderer.send('panels.toggle'),
  isOpen: () => ipcRenderer.invoke('panels.isOpen') as Promise<boolean>,
  onState: (cb: (open: boolean) => void) => {
    const listener = (_e: IpcRendererEvent, open: boolean) => cb(open);
    ipcRenderer.on('panels.state', listener);
    return () => {
      ipcRenderer.removeListener('panels.state', listener);
    };
  },
  relay: (msg: PanelsRelay) => ipcRenderer.send('panels.relay', msg),
  onRelay: (cb: (msg: PanelsRelay) => void) => {
    const listener = (_e: IpcRendererEvent, msg: PanelsRelay) => cb(msg);
    ipcRenderer.on('panels.relay', listener);
    return () => {
      ipcRenderer.removeListener('panels.relay', listener);
    };
  }
};

contextBridge.exposeInMainWorld('desktop', desktop);
contextBridge.exposeInMainWorld('desktopEvents', desktopEvents);
contextBridge.exposeInMainWorld('panels', panels);

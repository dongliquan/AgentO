import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, MenuNode } from '@shared/protocol';
import type { PanelsRelay, WindowRole } from '@shared/extra';

const desktop: DesktopApi = {
  getDaemonInfo: () => ipcRenderer.invoke('daemon.info') as Promise<{ port: number; token: string }>,
  pickFolder: () => ipcRenderer.invoke('dialog.pickFolder') as Promise<string | null>,
  openPath: (p: string) => ipcRenderer.invoke('shell.openPath', p) as Promise<void>,
  openInVsCode: (p: string) => ipcRenderer.invoke('shell.openVsCode', p) as Promise<void>,
  openExternalTerminal: (p: string) => ipcRenderer.invoke('shell.openTerminal', p) as Promise<void>,
  agentTerminal: (kind, action) => ipcRenderer.invoke('agents.terminal', kind, action) as Promise<void>,
  onMenu: (cb: (command: string) => void) => {
    const listener = (_e: IpcRendererEvent, command: string) => cb(command);
    ipcRenderer.on('menu', listener);
    return () => {
      ipcRenderer.removeListener('menu', listener);
    };
  },
  notify: (title: string, body: string, sessionId?: string) => {
    ipcRenderer.send('notify', title, body, sessionId);
  },
  menuLabels: () => ipcRenderer.invoke('menu.labels') as Promise<string[]>,
  popupMenu: (label: string, x: number, y: number) => ipcRenderer.send('menu.popup', label, x, y),
  menuTree: () => ipcRenderer.invoke('menu.tree') as Promise<MenuNode[]>,
  menuClick: (path: number[]) => ipcRenderer.send('menu.click', path),
  setTitleBarColors: (color: string, symbolColor: string) => ipcRenderer.send('titlebar.colors', color, symbolColor),
  platform: process.platform
};

/** Extra events beyond DesktopApi (renderer may ignore): 'focus-session' ({ sessionId }), 'daemon-restarted'. */
const desktopEvents = {
  onFocusSession: (cb: (sessionId: string) => void) => {
    const listener = (_e: IpcRendererEvent, payload: { sessionId: string }) => cb(payload.sessionId);
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
  }
};

const roleArg = process.argv.find((a) => a.startsWith('--agento-role='));
const role: WindowRole = roleArg?.slice('--agento-role='.length) === 'panels' ? 'panels' : 'main';

const panels = {
  role,
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

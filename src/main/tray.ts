import fs from 'node:fs';
import path from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';

export interface TrayActions {
  showWindow: () => void;
  quitKeep: () => void;
  quitAll: () => void;
}

/** 16x16 dark rounded square with a light dot — used when build/icon.png is missing. */
const FALLBACK_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mOYNWvef0owA4jQ1tYnCw9nA26Wh2PFowbQ04CRmBIpwQDNLvrk70TVWwAAAABJRU5ErkJggg==';

function trayIcon(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '../../build/icon.png')
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
      }
    } catch {
      /* try next */
    }
  }
  let img = nativeImage.createFromDataURL(FALLBACK_PNG);
  if (img.isEmpty()) {
    // last resort: solid 16x16 bitmap
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      buf[i * 4] = edge ? 0x80 : 0x30;
      buf[i * 4 + 1] = edge ? 0x80 : 0x30;
      buf[i * 4 + 2] = edge ? 0x80 : 0x34;
      buf[i * 4 + 3] = 0xff;
    }
    img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  }
  return img;
}

export function createTray(actions: TrayActions): Tray {
  const icon = trayIcon();
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('AgentO');
  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: () => actions.showWindow() },
    { type: 'separator' },
    { label: 'Quit (Keep Sessions)', click: () => actions.quitKeep() },
    { label: 'Stop All Sessions and Quit', click: () => actions.quitAll() }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => actions.showWindow());
  tray.on('double-click', () => actions.showWindow());
  return tray;
}

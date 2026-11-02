/**
 * Web pages (gemini.google.com, chatgpt.com … in the right panel's Web tab): <webview> tags in the main window.
 *
 * - One persistent partition, so a sign-in survives restarts and is shared by every web card.
 * - The user agent is Chrome's (Electron's own token removed): some sites refuse to sign in from an "embedded app".
 * - Hardened: no node, no preload, https pages only; sign-in pop-ups stay in the app, other links open in the
 *   system browser. AgentO never types into or reads these pages on its own — the user uses them.
 */
import { app, ipcMain, session, shell, type WebContents } from 'electron';

export const WEB_PARTITION = 'persist:agento-web';

/** Pop-ups a sign-in needs (Google, Apple, Microsoft, OpenAI, Anthropic): opened in a small app window. */
const AUTH_HOSTS = [/(^|\.)accounts\.google\.com$/, /(^|\.)appleid\.apple\.com$/, /(^|\.)login\.microsoftonline\.com$/, /(^|\.)live\.com$/, /(^|\.)auth\.openai\.com$/, /(^|\.)openai\.com$/, /(^|\.)anthropic\.com$/, /(^|\.)claude\.ai$/];

function isAuth(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return AUTH_HOSTS.some((r) => r.test(host));
  } catch {
    return false;
  }
}

function isHttps(url: string): boolean {
  return url.startsWith('https://');
}

/** Call once after app ready. */
export function setupWebviews(): void {
  const ses = session.fromPartition(WEB_PARTITION);
  // Chrome's user agent without "Electron/x" and the app's name
  ses.setUserAgent(app.userAgentFallback.replace(/\s(Electron|AgentO|agento)\/\S+/gi, ''));
  // no camera / mic / notifications / location for web pages unless the user is on them anyway: allow only clipboard
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read'));

  // a page's icon for the Web tab's chips: fetched here (the renderer's CSP allows no outside images), small only
  ipcMain.handle('web.favicon', async (_e, url: unknown): Promise<string | null> => {
    if (typeof url !== 'string' || !isHttps(url)) return null;
    try {
      const res = await ses.fetch(url);
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || 'image/x-icon').split(';')[0]!.trim();
      if (!/^image\//.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 200 * 1024) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  });

  app.on('web-contents-created', (_e, contents) => {
    // the app's own windows: harden every <webview> they attach
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete (prefs as { preload?: string }).preload;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      if (params.partition !== WEB_PARTITION || !isHttps(params.src)) event.preventDefault();
    });
    if (contents.getType() === 'webview') guardWebview(contents);
  });
}

function guardWebview(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuth(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true } };
    if (isHttps(url) || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isHttps(url)) e.preventDefault();
  });
}

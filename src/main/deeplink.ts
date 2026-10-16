import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { DispatchRequest } from '@shared/extra';

/**
 * `agento://dispatch?…` deep links: another app (ReadO's Commit / Push buttons) asks AgentO to have the team do
 * something in a repository. Only a whitelist of kinds is accepted and the link carries data, never commands; the
 * renderer then asks the manager to confirm and only sends it to the project that owns the repository.
 *
 *   agento://dispatch?kind=commit&repo=C:\x\repo&branch=main&ahead=0&files=3&msg=Fix…&from=ReadO&ref=<id>
 *
 * `ref` names `%APPDATA%\<from>\requests\<id>.json` with the long parts (the changed-file list).
 */
const SCHEME = 'agento';
const KINDS = new Set<DispatchRequest['kind']>(['commit', 'push']);
const MAX_TEXT = 500;
const MAX_FILES = 300;
const MAX_REF_BYTES = 512 * 1024;

/** Make Windows / macOS open `agento://` links with this app (a dev run registers electron + its script). */
export function registerScheme(): void {
  try {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient(SCHEME);
  } catch {
    /* not fatal: links just fall back to ReadO's clipboard copy */
  }
}

/** The deep link among command-line arguments (Windows passes it to a new / second instance). */
export function linkInArgs(argv: string[]): string | undefined {
  return argv.find((a) => a.toLowerCase().startsWith(`${SCHEME}://`));
}

const clip = (v: string | null, n = MAX_TEXT): string | undefined => (v ? v.slice(0, n) : undefined);
const int = (v: string | null): number | undefined => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** Parse and check a link; an error message instead when it is not a request AgentO takes. */
export function parseDispatch(raw: string): DispatchRequest | { error: string; url: string } {
  const url = raw.slice(0, 4000);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: 'Not a valid link', url };
  }
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
  if (u.protocol !== `${SCHEME}:` || action !== 'dispatch') return { error: `Unknown request "${action}"`, url };
  const q = u.searchParams;
  const kind = q.get('kind') as DispatchRequest['kind'] | null;
  if (!kind || !KINDS.has(kind)) return { error: `Request kind "${q.get('kind') ?? ''}" is not allowed (only commit, push)`, url };
  const repo = q.get('repo');
  if (!repo || !path.isAbsolute(repo)) return { error: 'The request has no repository path', url };
  const from = (clip(q.get('from'), 40) ?? 'another app').replace(/[^\w .-]/g, '');
  const req: DispatchRequest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    repo: path.resolve(repo),
    from,
    url,
    ...(clip(q.get('branch'), 200) ? { branch: clip(q.get('branch'), 200)! } : {}),
    ...(int(q.get('ahead')) !== undefined ? { ahead: int(q.get('ahead'))! } : {}),
    ...(int(q.get('files')) !== undefined ? { files: int(q.get('files'))! } : {}),
    ...(clip(q.get('msg')) ? { msg: clip(q.get('msg'))! } : {})
  };
  // the long parts, from the sending app's own requests folder only
  const ref = q.get('ref');
  if (ref) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref)) return { error: 'Bad request reference', url };
    // the sender's own data folder (ReadO when the link does not say)
    const dir = path.join(app.getPath('appData'), q.get('from') ? from : 'ReadO', 'requests');
    const file = path.join(dir, `${ref}.json`);
    try {
      if (fs.statSync(file).size <= MAX_REF_BYTES) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { files?: unknown; message?: unknown; msg?: unknown };
        const list = Array.isArray(data.files) ? data.files : [];
        req.fileList = list
          .map((f) => (typeof f === 'string' ? f : f && typeof f === 'object' && typeof (f as { path?: unknown }).path === 'string' ? `${(f as { status?: string }).status ? `${(f as { status: string }).status} ` : ''}${(f as { path: string }).path}` : ''))
          .filter(Boolean)
          .slice(0, MAX_FILES)
          .map((f) => f.slice(0, 300));
        const m = typeof data.message === 'string' ? data.message : typeof data.msg === 'string' ? data.msg : undefined;
        if (m && !req.msg) req.msg = m.slice(0, 2000);
      }
    } catch {
      /* no file: the link alone is enough */
    }
  }
  return req;
}

/**
 * Deliver links to the main window's renderer: queued until it has loaded (a link can start the app), then sent as
 * 'dispatch' (or 'dispatch.error').
 */
export class DispatchQueue {
  private pending: string[] = [];
  private ready = false;

  constructor(private readonly getWindow: () => BrowserWindow | null, private readonly showWindow: () => void) {}

  push(raw: string): void {
    this.pending.push(raw);
    this.flush();
  }

  /** the window (re)loaded its page */
  loaded(): void {
    this.ready = true;
    this.flush();
  }

  unloaded(): void {
    this.ready = false;
  }

  private flush(): void {
    const win = this.getWindow();
    if (!win || !this.ready) return;
    const list = this.pending.splice(0);
    if (list.length) this.showWindow();
    for (const raw of list) {
      const r = parseDispatch(raw);
      if ('error' in r) win.webContents.send('dispatch.error', r);
      else win.webContents.send('dispatch', r);
    }
  }
}

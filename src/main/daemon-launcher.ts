/**
 * Ensures the background daemon is running and reachable; launches it detached if not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@shared/protocol';
import type { DaemonInfoFile } from '@shared/extra';

export { dataDir } from '@shared/datadir';
import { dataDir } from '@shared/datadir';

export function daemonJsonPath(): string {
  return path.join(dataDir(), 'daemon.json');
}

export function daemonLogPath(): string {
  return path.join(dataDir(), 'daemon.log');
}

export function readDaemonInfo(): DaemonInfoFile | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(daemonJsonPath(), 'utf8')) as Partial<DaemonInfoFile>;
    if (typeof j.port === 'number' && typeof j.token === 'string' && typeof j.pid === 'number') {
      return { port: j.port, token: j.token, pid: j.pid, version: j.version ?? '' };
    }
  } catch {
    /* none */
  }
  return undefined;
}

/** Sends hello; resolves true when the daemon answers with welcome. */
export function probeDaemon(port: number, token: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, client: 'cli' } satisfies ClientMessage)));
    ws.on('message', (data) => {
      try {
        finish((JSON.parse(data.toString()) as ServerMessage).type === 'welcome');
      } catch {
        finish(false);
      }
    });
    ws.on('error', () => finish(false));
    ws.on('close', () => finish(false));
  });
}

export function daemonScriptPath(): string {
  return path.join(__dirname, '../daemon/index.js');
}

export function spawnDaemon(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ASM_VERSION: app.getVersion() };
  const child = spawn(process.execPath, [daemonScriptPath()], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
    cwd: dataDir()
  });
  child.on('error', (err) => {
    // Nothing we can do here; ensureDaemon() will time out and report.
    // eslint-disable-next-line no-console
    console.error('[daemon-launcher] spawn error', err);
  });
  child.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns daemon info once reachable. Launches the daemon when needed.
 * Throws after `timeoutMs` if it never comes up.
 */
export async function ensureDaemon(timeoutMs = 10_000): Promise<DaemonInfoFile> {
  const existing = readDaemonInfo();
  if (existing && (await probeDaemon(existing.port, existing.token))) return existing;

  spawnDaemon();
  const deadline = Date.now() + timeoutMs;
  let lastSeen: DaemonInfoFile | undefined;
  while (Date.now() < deadline) {
    await sleep(250);
    const info = readDaemonInfo();
    if (!info) continue;
    // ignore a stale file from the previous daemon (same pid as before and not answering)
    if (existing && info.pid === existing.pid && info.token === existing.token) continue;
    lastSeen = info;
    if (await probeDaemon(info.port, info.token, 800)) return info;
  }
  throw new Error(
    lastSeen
      ? `The daemon is not responding (port ${lastSeen.port}). Log: ${daemonLogPath()}`
      : `Failed to start the daemon. Log: ${daemonLogPath()}`
  );
}

/** Sends daemon.shutdown and waits for the socket to close (best effort). */
export function shutdownDaemon(killSessions: boolean, timeoutMs = 5000): Promise<void> {
  const info = readDaemonInfo();
  if (!info) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${info.port}`);
    } catch {
      clearTimeout(timer);
      resolve();
      return;
    }
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', token: info.token, client: 'cli' } satisfies ClientMessage));
      ws.send(JSON.stringify({ type: 'daemon.shutdown', killSessions } satisfies ClientMessage));
    });
    ws.on('close', finish);
    ws.on('error', finish);
  });
}

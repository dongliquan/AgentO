import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { holdersDir } from './paths';
import { log } from './log';

/**
 * The daemon's side of a session holder (holder.ts): starts one for a new session, or attaches to one that is still
 * running from before a daemon restart, and relays writes and events over its pipe. Writes sent before the pipe is up
 * are queued.
 */
export interface HolderSpec {
  id: string;
  /** set by start(): this holder instance */
  nonce?: string;
  kind: 'pty' | 'stream';
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface HolderInfo {
  id: string;
  nonce?: string;
  pid: number;
  childPid?: number;
  pipe: string;
  kind: 'pty' | 'stream';
  startedAt: number;
}

export interface HolderExit {
  nonce?: string;
  code: number | null;
  signal: string | number | null;
  at: number;
}

export interface HolderEvents {
  hello: (info: { childPid?: number; alive: boolean; kind: 'pty' | 'stream'; startedAt: number }) => void;
  data: (d: string) => void;
  event: (j: Record<string, unknown>) => void;
  stderr: (d: string) => void;
  exit: (code: number | null, signal: string | number | null) => void;
  /** the pipe closed without an exit (the holder died) */
  lost: () => void;
}

const alivePid = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export class HolderClient extends EventEmitter {
  private sock: net.Socket | null = null;
  private queue: string[] = [];
  private exited = false;
  private detached = false;

  constructor(readonly id: string) {
    super();
  }

  override on<K extends keyof HolderEvents>(event: K, listener: HolderEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof HolderEvents>(event: K, ...args: Parameters<HolderEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  /** The holder script next to the daemon's bundle (out/holder/index.js). */
  static scriptPath(): string {
    return path.join(__dirname, '../holder/index.js');
  }

  /** Holders whose process is still alive, by session id. */
  static listHolders(): Map<string, HolderInfo> {
    const out = new Map<string, HolderInfo>();
    for (const f of fs.readdirSync(holdersDir())) {
      if (!f.endsWith('.json') || f.endsWith('.exit.json')) continue;
      try {
        const info = JSON.parse(fs.readFileSync(path.join(holdersDir(), f), 'utf8')) as HolderInfo;
        if (info.id && info.pid && alivePid(info.pid)) out.set(info.id, info);
        else fs.unlinkSync(path.join(holdersDir(), f));
      } catch {
        /* a half-written file: skipped */
      }
    }
    return out;
  }

  /** Children that ended while no daemon was connected, by session id. */
  static listExits(): Map<string, HolderExit> {
    const out = new Map<string, HolderExit>();
    for (const f of fs.readdirSync(holdersDir())) {
      if (!f.endsWith('.exit.json')) continue;
      try {
        out.set(f.slice(0, -'.exit.json'.length), JSON.parse(fs.readFileSync(path.join(holdersDir(), f), 'utf8')) as HolderExit);
      } catch {
        /* skipped */
      }
    }
    return out;
  }

  static clearExit(id: string): void {
    try {
      fs.unlinkSync(path.join(holdersDir(), `${id}.exit.json`));
    } catch {
      /* none */
    }
  }

  /** Start a holder for a new process and connect to it. */
  async start(spec: HolderSpec): Promise<void> {
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const specFile = path.join(holdersDir(), `${spec.id}.spec.json`);
    fs.writeFileSync(specFile, JSON.stringify({ ...spec, nonce }));
    HolderClient.clearExit(spec.id);
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const child = spawn(process.execPath, [HolderClient.scriptPath(), specFile], { detached: true, stdio: 'ignore', env, windowsHide: true });
    child.on('error', (e) => log.warn('holder: spawn failed', spec.id, e));
    child.unref();
    const infoFile = path.join(holdersDir(), `${spec.id}.json`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(infoFile)) {
        try {
          const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as HolderInfo;
          // ours — not the previous holder of this session, which may still be closing
          if (info.nonce === nonce) {
            await this.connect(info.pipe);
            return;
          }
        } catch {
          /* half-written: again */
        }
      }
      const ex = HolderClient.listExits().get(spec.id);
      if (ex && ex.nonce === nonce) {
        // it ended before we could connect (e.g. the command was not found)
        this.exited = true;
        this.emit('exit', ex.code, ex.signal);
        HolderClient.clearExit(spec.id);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the session holder did not come up');
  }

  /** Attach to a holder that is still running (after a daemon restart). */
  attach(info: HolderInfo): Promise<void> {
    return this.connect(info.pipe);
  }

  private connect(pipe: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(pipe);
      let buf = '';
      let opened = false;
      sock.setNoDelay(true);
      sock.on('connect', () => {
        opened = true;
        this.sock = sock;
        for (const line of this.queue) sock.write(line);
        this.queue = [];
        resolve();
      });
      sock.on('data', (d) => {
        buf += d.toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) this.handle(line);
        }
      });
      sock.on('error', (e) => {
        if (!opened) reject(e);
      });
      sock.on('close', () => {
        if (this.sock === sock) this.sock = null;
        if (opened && !this.exited && !this.detached) this.emit('lost');
      });
    });
  }

  private handle(line: string): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (m['t']) {
      case 'hello':
        this.emit('hello', { childPid: typeof m['childPid'] === 'number' ? (m['childPid'] as number) : undefined, alive: m['alive'] !== false, kind: m['kind'] === 'stream' ? 'stream' : 'pty', startedAt: Number(m['startedAt']) || Date.now() });
        break;
      case 'data':
        this.emit('data', String(m['d'] ?? ''));
        break;
      case 'event':
        if (typeof m['j'] === 'object' && m['j'] !== null) this.emit('event', m['j'] as Record<string, unknown>);
        break;
      case 'stderr':
        this.emit('stderr', String(m['d'] ?? ''));
        break;
      case 'exit':
        this.exited = true;
        HolderClient.clearExit(this.id);
        this.emit('exit', typeof m['code'] === 'number' ? (m['code'] as number) : null, (m['signal'] as string | number | null) ?? null);
        break;
      default:
        break;
    }
  }

  private sendMsg(m: Record<string, unknown>): void {
    const line = `${JSON.stringify(m)}\n`;
    if (this.sock && !this.sock.destroyed) this.sock.write(line);
    else if (!this.exited) this.queue.push(line);
  }

  write(d: string): void {
    this.sendMsg({ t: 'write', d });
  }
  resize(cols: number, rows: number): void {
    this.sendMsg({ t: 'resize', cols, rows });
  }
  send(text: string): void {
    this.sendMsg({ t: 'send', text });
  }
  interrupt(): void {
    this.sendMsg({ t: 'interrupt' });
  }
  end(): void {
    this.sendMsg({ t: 'end' });
  }
  kill(): void {
    this.sendMsg({ t: 'kill' });
  }

  /** Drop the pipe and leave the process running (the daemon is restarting; the next one attaches). */
  detach(): void {
    this.detached = true;
    this.sock?.destroy();
    this.sock = null;
  }
}

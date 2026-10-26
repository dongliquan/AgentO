/**
 * Session holder — a small detached process that owns one session's CLI process (a terminal via node-pty, or a
 * headless `claude -p` with JSON in / out) so that the daemon can restart without ending the session. The daemon
 * talks to it over a local pipe with JSON lines; while no daemon is connected, output is kept (up to a cap) and
 * replayed on the next connection.
 *
 *   holder/index.js <spec.json>     spec: { id, kind: 'pty' | 'stream', file, args, cwd, env, cols, rows }
 *
 * It writes holders/<id>.json (pid, pipe, child pid) while the child runs, holders/<id>.exit.json when the child
 * ends, and exits itself shortly after the child.
 *
 *   daemon → holder:  {t:'write',d} {t:'resize',cols,rows} {t:'send',text} {t:'interrupt'} {t:'end'} {t:'kill'}
 *   holder → daemon:  {t:'hello',childPid,alive,kind,startedAt} {t:'data',d} {t:'event',j} {t:'stderr',d} {t:'exit',code,signal}
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as pty from 'node-pty';
import { StreamProc } from './stream';
import { holdersDir, holderPipe } from './paths';

interface Spec {
  id: string;
  /** this holder instance (a restarted session gets a new one while the old holder is still closing) */
  nonce: string;
  kind: 'pty' | 'stream';
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

const BACKLOG_MAX = 1024 * 1024;

const specFile = process.argv[2];
if (!specFile) {
  process.stderr.write('holder: spec file missing\n');
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8')) as Spec;
const startedAt = Date.now();
const infoFile = path.join(holdersDir(), `${spec.id}.json`);
const exitFile = path.join(holdersDir(), `${spec.id}.exit.json`);
const pipe = holderPipe(spec.id, spec.nonce);

let client: net.Socket | null = null;
const backlog: string[] = [];
let backlogBytes = 0;
let childPid: number | undefined;
let alive = true;
let finishing = false;

function emit(msg: Record<string, unknown>): void {
  const line = `${JSON.stringify(msg)}\n`;
  if (client && !client.destroyed) {
    client.write(line);
    return;
  }
  backlog.push(line);
  backlogBytes += line.length;
  while (backlogBytes > BACKLOG_MAX && backlog.length > 1) backlogBytes -= backlog.shift()!.length;
}

function writeInfo(): void {
  fs.writeFileSync(infoFile, JSON.stringify({ id: spec.id, nonce: spec.nonce, pid: process.pid, childPid, pipe, kind: spec.kind, startedAt }));
}

/** the info file still names this holder (a newer holder of the same session may have replaced it) */
function infoIsMine(): boolean {
  try {
    return (JSON.parse(fs.readFileSync(infoFile, 'utf8')) as { nonce?: string }).nonce === spec.nonce;
  } catch {
    return false;
  }
}

function finish(code: number | null, signal: string | number | null | undefined): void {
  if (finishing) return;
  finishing = true;
  alive = false;
  emit({ t: 'exit', code, signal: signal ?? null });
  // the end is recorded only while this holder is the session's current one (a restart already started another)
  if (infoIsMine()) {
    try {
      fs.writeFileSync(exitFile, JSON.stringify({ id: spec.id, nonce: spec.nonce, code, signal: signal ?? null, at: Date.now() }));
    } catch {
      /* best effort */
    }
  }
  // give a connected daemon a moment to read the exit, then go
  setTimeout(() => {
    try {
      if (infoIsMine()) fs.unlinkSync(infoFile);
    } catch {
      /* gone */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }, 1500);
}

// ---------- the child ----------
let handle: { write(d: string): void; resize(c: number, r: number): void; send(text: string): void; interrupt(): void; end(): void; kill(): void };
try {
  if (spec.kind === 'pty') {
    const p = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols: spec.cols || 100, rows: spec.rows || 30, cwd: spec.cwd, env: spec.env, useConpty: process.platform === 'win32' });
    childPid = p.pid;
    p.onData((d) => emit({ t: 'data', d }));
    p.onExit(({ exitCode, signal }) => finish(exitCode, signal));
    handle = {
      write: (d) => p.write(d),
      resize: (c, r) => {
        try {
          p.resize(Math.max(2, c), Math.max(1, r));
        } catch {
          /* ignore */
        }
      },
      send: () => {},
      interrupt: () => p.write('\x03'),
      end: () => {},
      kill: () => {
        try {
          if (process.platform === 'win32') p.kill();
          else p.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    };
  } else {
    const s = new StreamProc(spec.file, spec.args, { cwd: spec.cwd, env: spec.env }, {
      event: (j) => emit({ t: 'event', j }),
      stderr: (d) => emit({ t: 'stderr', d }),
      exit: (code, signal) => finish(code, signal)
    });
    childPid = s.pid;
    handle = { write: () => {}, resize: () => {}, send: (text) => void s.sendUser(text), interrupt: () => void s.interrupt(), end: () => s.end(), kill: () => s.kill() };
  }
} catch (e) {
  emit({ t: 'stderr', d: `${e instanceof Error ? e.message : String(e)}\n` });
  handle = { write: () => {}, resize: () => {}, send: () => {}, interrupt: () => {}, end: () => {}, kill: () => {} };
  setTimeout(() => finish(127, null), 50);
}

// ---------- the pipe ----------
const server = net.createServer((sock) => {
  if (client && !client.destroyed) client.destroy();
  client = sock;
  sock.setNoDelay(true);
  sock.write(`${JSON.stringify({ t: 'hello', childPid, alive, kind: spec.kind, startedAt })}\n`);
  for (const line of backlog) sock.write(line);
  backlog.length = 0;
  backlogBytes = 0;
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line) as Record<string, unknown>;
        switch (m['t']) {
          case 'write':
            handle.write(String(m['d'] ?? ''));
            break;
          case 'resize':
            handle.resize(Number(m['cols']), Number(m['rows']));
            break;
          case 'send':
            handle.send(String(m['text'] ?? ''));
            break;
          case 'interrupt':
            handle.interrupt();
            break;
          case 'end':
            handle.end();
            break;
          case 'kill':
            handle.kill();
            break;
          default:
            break;
        }
      } catch {
        /* a bad line is ignored */
      }
    }
  });
  sock.on('close', () => {
    if (client === sock) client = null;
  });
  sock.on('error', () => {
    /* the daemon went away; output is kept for the next one */
  });
});
if (process.platform !== 'win32') {
  try {
    fs.unlinkSync(pipe);
  } catch {
    /* none */
  }
}
server.listen(pipe, () => writeInfo());
server.on('error', (e) => {
  process.stderr.write(`holder: pipe error ${e.message}\n`);
  handle.kill();
  finish(-1, null);
});

process.on('uncaughtException', (e) => {
  process.stderr.write(`holder: ${e.message}\n`);
  finish(-1, null);
});

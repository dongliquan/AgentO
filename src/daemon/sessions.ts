/**
 * Session manager: owns every PTY, ring buffers, status detection, hibernate/resume.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { AgentKind, InboxItem, Session, SessionRole, SessionStatus } from '@shared/protocol';
import { Store, type StoredSession } from './store';
import { defaultShell, findClaudeResumeId, getAgentDef, resolveCommand } from './agents';
import { findTranscript } from './transcript';
import { logsDir } from './paths';
import { cardSize } from '@shared/layout';
import { log } from './log';

const RING_BUFFER_BYTES = 200 * 1024;
const QUIET_MS = 2500;
const SINCE_INPUT_CAP = 8 * 1024;
/** A working burst shorter than this (e.g. echo of typed input) does not raise a 'waiting' inbox item. */
const MIN_WORKING_FOR_INBOX_MS = 3000;
const AUTO_HIBERNATE_MIN = Math.max(1, Number(process.env['ASM_HIBERNATE_MIN'] || 30) || 30);

const OSC_TITLE_RE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export interface CreateSessionOpts {
  projectId: string;
  folderId: string;
  cwd: string;
  agent: AgentKind;
  role?: SessionRole;
  title?: string;
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  /** Claude only: first prompt, passed on the command line of the first launch */
  prompt?: string;
}

interface Live {
  proc: pty.IPty;
  startedAt: number;
  quietTimer: NodeJS.Timeout | null;
  workingSince: number;
  /** set when we killed the process intentionally (hibernate/restart/kill) */
  intent: 'none' | 'hibernate' | 'restart' | 'kill' | 'remove';
  titleTail: string;
  logStream: fs.WriteStream | null;
  /** output since the last input was written (what is on screen now — a prompt shown here is still unanswered) */
  sinceInput: string;
}

export interface SessionManagerEvents {
  upsert: (session: Session) => void;
  removed: (id: string) => void;
  data: (id: string, data: string) => void;
  inbox: (item: InboxItem) => void;
}

const INHERITED_CLAUDE_VARS = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_ENABLE_TASKS'
]);

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, StoredSession>();
  private live = new Map<string, Live>();
  private buffers = new Map<string, string>();
  private waitingSince = new Map<string, number>();
  private hibernateTimer: NodeJS.Timeout | null = null;

  constructor(private store: Store) {
    super();
    for (const s of store.listSessions()) {
      // Daemon restarted: nothing is running anymore. Mark previously-running sessions.
      if (s.status === 'starting' || s.status === 'working' || s.status === 'waiting') {
        s.status = s.resumeId ? 'hibernated' : 'error';
        s.pid = undefined;
        s.updatedAt = Date.now();
        store.upsertSession(s);
      }
      this.sessions.set(s.id, s);
      this.buffers.set(s.id, this.loadLogTail(s.id));
    }
    this.hibernateTimer = setInterval(() => this.autoHibernateTick(), 60_000);
  }

  override on<K extends keyof SessionManagerEvents>(event: K, listener: SessionManagerEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override emit<K extends keyof SessionManagerEvents>(event: K, ...args: Parameters<SessionManagerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  /** Optional hook so the server can tell us which sessions have a UI attached. */
  isAttached: (id: string) => boolean = () => false;

  /** Extra CLI args per launch (team sessions get their MCP connection and project folders); set by the server. */
  launchExtras: (s: StoredSession) => string[] = () => [];

  /** True when a 'waiting' transition should not raise an inbox item (team work in progress); set by the server. */
  quietWaiting: (s: StoredSession) => boolean = () => false;

  /** Extra environment per launch (e.g. the MCP bearer token for a Codex coach); set by the server. */
  launchEnv: (s: StoredSession) => Record<string, string> = () => ({});

  /* ---------- queries ---------- */

  list(): Session[] {
    return [...this.sessions.values()].map((s) => this.publicSession(s));
  }

  get(id: string): StoredSession | undefined {
    return this.sessions.get(id);
  }

  scrollback(id: string): string {
    return this.buffers.get(id) ?? '';
  }

  private publicSession(s: StoredSession): Session {
    // Extra fields (command/args) are harmless for the renderer, but keep the wire shape tidy.
    const { command: _c, args: _a, ...rest } = s;
    return rest;
  }

  private logPath(id: string): string {
    return path.join(logsDir(), `${id}.log`);
  }

  private loadLogTail(id: string): string {
    try {
      const p = this.logPath(id);
      const st = fs.statSync(p);
      const size = st.size;
      const start = Math.max(0, size - RING_BUFFER_BYTES);
      const fd = fs.openSync(p, 'r');
      try {
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        return buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
  }

  /* ---------- persistence helpers ---------- */

  private save(s: StoredSession, touch = true): void {
    if (touch) s.updatedAt = Date.now();
    this.sessions.set(s.id, s);
    this.store.upsertSession(s);
    this.emit('upsert', this.publicSession(s));
  }

  private setStatus(s: StoredSession, status: SessionStatus): void {
    if (s.status === status) return;
    const prev = s.status;
    s.status = status;
    if (status === 'waiting') this.waitingSince.set(s.id, Date.now());
    else this.waitingSince.delete(s.id);
    this.save(s);
    if (prev === 'working' && status === 'waiting') this.onBecameWaiting(s);
  }

  private onBecameWaiting(s: StoredSession): void {
    const live = this.live.get(s.id);
    if (live && Date.now() - live.workingSince < MIN_WORKING_FOR_INBOX_MS) return;
    if (this.quietWaiting(s)) return;
    const last = this.store.lastInboxForSession(s.id);
    if (last && last.kind === 'waiting' && !last.read) return;
    const item = this.store.addInbox(s.id, 'waiting', `${s.title} — waiting for input`);
    this.emit('inbox', item);
  }

  private appendOutput(s: StoredSession, data: string): void {
    const cur = (this.buffers.get(s.id) ?? '') + data;
    this.buffers.set(s.id, cur.length > RING_BUFFER_BYTES * 1.25 ? cur.slice(cur.length - RING_BUFFER_BYTES) : cur);
    const live = this.live.get(s.id);
    live?.logStream?.write(data);
    if (live) live.sinceInput = (live.sinceInput + data).slice(-SINCE_INPUT_CAP);
    this.emit('data', s.id, data);
  }

  /* ---------- spawning ---------- */

  private buildEnv(s: StoredSession): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k === 'ELECTRON_RUN_AS_NODE' || k === 'ELECTRON_NO_ATTACH_CONSOLE') continue;
      // Runtime vars of a parent Claude Code process (e.g. AgentO launched from Claude Code in VS Code).
      // Inherited, they make child `claude` sessions think they are nested (transcripts off, wrong session id).
      if (INHERITED_CLAUDE_VARS.has(k)) continue;
      env[k] = v;
    }
    env['TERM'] = 'xterm-256color';
    env['COLORTERM'] = 'truecolor';
    env['ASM_SESSION'] = '1';
    if (!env['LANG'] && process.platform !== 'win32') env['LANG'] = 'en_US.UTF-8';
    return { ...env, ...this.launchEnv(s) };
  }

  private resolveLaunch(s: StoredSession, mode: 'fresh' | 'resume', prompt?: string): { file: string; args: string[] } {
    const def = getAgentDef(s.agent);
    let command = s.command || def.command;
    let args: string[] = s.args ?? def.args;

    if (s.agent === 'shell' && !s.command) {
      command = defaultShell();
      args = [];
    }
    if (s.agent === 'claude' && !s.command) {
      // Pin the Claude session id so the transcript (and chat view) maps 1:1 to this session.
      // A pinned id with no transcript yet (nothing was sent) cannot be resumed: start it fresh under the same id.
      if (mode === 'resume' && s.resumeId && !findTranscript(s.cwd, s.resumeId)) mode = 'fresh';
      if (mode === 'fresh') {
        if (!s.resumeId || findTranscript(s.cwd, s.resumeId)) s.resumeId = randomUUID();
        args = [...args, '--session-id', s.resumeId];
      }
    }
    if (mode === 'resume' && s.resumeId && def.resumeArgs && !s.command) {
      args = def.resumeArgs.map((a) => a.replace('{id}', s.resumeId as string));
    }
    if (!s.command) {
      // positional prompt before the variadic options (--add-dir, --mcp-config, --allowedTools)
      if (s.agent === 'claude' && mode === 'fresh' && prompt) args = [...args, prompt];
      args = [...args, ...this.launchExtras(s)];
    }
    if (!command) throw new Error('No command specified');
    const resolved = resolveCommand(command);
    if (!resolved) throw new Error(`Command not found: ${command}`);
    return { file: resolved, args: [...args] };
  }

  private spawn(s: StoredSession, mode: 'fresh' | 'resume', prompt?: string): void {
    if (this.live.has(s.id)) throw new Error('Session is already running');
    let launch: { file: string; args: string[] };
    try {
      launch = this.resolveLaunch(s, mode, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      s.status = 'error';
      s.pid = undefined;
      s.exitCode = 127;
      this.save(s);
      this.appendOutput(s, `\r\n\x1b[31m[agento] ${msg}\x1b[0m\r\n`);
      throw e;
    }
    const cwd = fs.existsSync(s.cwd) ? s.cwd : process.cwd();
    let proc: pty.IPty;
    try {
      proc = pty.spawn(launch.file, launch.args, {
        name: 'xterm-256color',
        cols: s.cols || 100,
        rows: s.rows || 30,
        cwd,
        env: this.buildEnv(s),
        useConpty: process.platform === 'win32'
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      s.status = 'error';
      s.pid = undefined;
      s.exitCode = 127;
      this.save(s);
      this.appendOutput(s, `\r\n\x1b[31m[agento] spawn failed: ${msg}\x1b[0m\r\n`);
      throw e;
    }

    const logStream = fs.createWriteStream(this.logPath(s.id), { flags: 'a' });
    logStream.on('error', (err) => log.warn('log stream error', s.id, err));
    const banner = `\r\n\x1b[2m[${new Date().toISOString()}] ${mode === 'resume' ? 'resume' : 'start'}: ${launch.file} ${launch.args.join(' ')}\x1b[0m\r\n`;

    const live: Live = {
      proc,
      startedAt: Date.now(),
      quietTimer: null,
      workingSince: Date.now(),
      intent: 'none',
      titleTail: '',
      logStream,
      sinceInput: ''
    };
    this.live.set(s.id, live);
    s.pid = proc.pid;
    s.exitCode = undefined;
    s.status = 'starting';
    this.save(s);
    this.appendOutput(s, banner);
    log.info('spawned', s.id, s.agent, launch.file, launch.args, 'pid', proc.pid);

    proc.onData((data) => this.onData(s.id, data));
    proc.onExit(({ exitCode, signal }) => this.onExit(s.id, exitCode, signal));
  }

  private onData(id: string, data: string): void {
    const s = this.sessions.get(id);
    const live = this.live.get(id);
    if (!s || !live) return;
    this.appendOutput(s, data);

    // OSC title hints
    const hint = this.parseTitleHint(live, data);
    if (hint === 'waiting') {
      if (live.quietTimer) clearTimeout(live.quietTimer);
      live.quietTimer = null;
      this.setStatus(s, 'waiting');
      return;
    }
    if (s.status !== 'working') live.workingSince = Date.now();
    if (s.status !== 'working') this.setStatus(s, 'working');
    if (live.quietTimer) clearTimeout(live.quietTimer);
    live.quietTimer = setTimeout(() => {
      live.quietTimer = null;
      const cur = this.sessions.get(id);
      if (cur && this.live.get(id) === live && cur.status === 'working') this.setStatus(cur, 'waiting');
    }, QUIET_MS);
  }

  private parseTitleHint(live: Live, data: string): 'working' | 'waiting' | null {
    const text = live.titleTail + data;
    live.titleTail = text.slice(-512);
    let hint: 'working' | 'waiting' | null = null;
    OSC_TITLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OSC_TITLE_RE.exec(text))) {
      const title = m[1] ?? '';
      if (title.includes('✻') || /working|thinking|running/i.test(title)) hint = 'working';
      else if (/waiting|input|\?/i.test(title)) hint = 'waiting';
    }
    if (hint) live.titleTail = '';
    return hint;
  }

  private onExit(id: string, exitCode: number, signal?: number): void {
    // After killAll() the store may already be closed; state was persisted there.
    if (this.closed) return;
    const s = this.sessions.get(id);
    const live = this.live.get(id);
    if (!s) return;
    if (live) {
      if (live.quietTimer) clearTimeout(live.quietTimer);
      live.logStream?.end();
      this.live.delete(id);
    }
    const intent = live?.intent ?? 'none';
    log.info('exit', id, 'code', exitCode, 'signal', signal, 'intent', intent);

    // Discover a resume id (Claude Code writes the transcript under ~/.claude/projects).
    if (s.agent === 'claude' && !s.resumeId) {
      const found = findClaudeResumeId(s.cwd, live?.startedAt);
      if (found) s.resumeId = found;
    }
    s.pid = undefined;
    this.waitingSince.delete(id);

    if (intent === 'remove') return; // store row already gone
    if (intent === 'hibernate') {
      s.status = 'hibernated';
      s.exitCode = undefined;
      this.save(s);
      this.appendOutput(s, `\r\n\x1b[2m[agento] session hibernated\x1b[0m\r\n`);
      return;
    }
    if (intent === 'restart') {
      this.save(s, false);
      setTimeout(() => {
        if (this.sessions.has(id) && !this.live.has(id)) this.safeSpawn(s, 'fresh');
      }, 100);
      return;
    }

    s.exitCode = exitCode;
    s.status = exitCode === 0 || (intent === 'kill' && exitCode === 0) ? 'done' : 'error';
    this.save(s);
    this.appendOutput(s, `\r\n\x1b[2m[agento] process exited (code ${exitCode})\x1b[0m\r\n`);
    const item = this.store.addInbox(
      s.id,
      s.status === 'done' ? 'done' : 'error',
      s.status === 'done' ? `${s.title} — finished` : `${s.title} — exited with error (code ${exitCode})`
    );
    this.emit('inbox', item);
  }

  /** First grid cell (3 columns) that doesn't overlap existing cards in the same project (team sessions: any card). */
  private freeSlot(projectId: string | null, w: number, h: number): { x: number; y: number } {
    const GAP = 40;
    const others = [...this.sessions.values()].filter((o) => projectId === null || o.projectId === projectId);
    const hits = (x: number, y: number): boolean =>
      others.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
    for (let i = 0; i < 300; i++) {
      const x = GAP + (i % 3) * (w + GAP);
      const y = GAP + Math.floor(i / 3) * (h + GAP);
      if (!hits(x, y)) return { x, y };
    }
    return { x: GAP, y: GAP };
  }

  /* ---------- public operations ---------- */

  create(opts: CreateSessionOpts): Session {
    const def = getAgentDef(opts.agent);
    const now = Date.now();
    const role = opts.role ?? 'player';
    const size = cardSize(role);
    const pos = this.freeSlot(role === 'player' ? opts.projectId : null, size.w, size.h);
    const s: StoredSession = {
      id: randomUUID(),
      projectId: opts.projectId,
      folderId: opts.folderId,
      cwd: opts.cwd,
      agent: opts.agent,
      role,
      title: opts.title?.trim() || `${def.label} · ${path.basename(opts.cwd) || opts.cwd}`,
      color: def.color,
      status: 'starting',
      createdAt: now,
      updatedAt: now,
      x: pos.x,
      y: pos.y,
      w: size.w,
      h: size.h,
      cols: opts.cols && opts.cols > 0 ? opts.cols : 100,
      rows: opts.rows && opts.rows > 0 ? opts.rows : 30
    };
    if (opts.command) s.command = opts.command;
    if (opts.args) s.args = opts.args;
    this.buffers.set(s.id, '');
    this.save(s);
    try {
      this.spawn(s, 'fresh', opts.prompt);
    } catch (e) {
      log.warn('create: spawn failed', s.id, e);
    }
    return this.publicSession(s);
  }

  /**
   * A session from a project file: stored with its layout, not started (it wakes when it gets work). With a resume id
   * it is hibernated (resumes its conversation), otherwise done (starts fresh).
   */
  restore(opts: CreateSessionOpts & { x?: number; y?: number; w?: number; h?: number; color?: string; resumeId?: string }): Session {
    const def = getAgentDef(opts.agent);
    const now = Date.now();
    // no saved layout: a free spot like a new session
    const size = { w: opts.w ?? cardSize(opts.role ?? 'player').w, h: opts.h ?? cardSize(opts.role ?? 'player').h };
    // (clear of every card: imports land in several parts at once)
    const pos = opts.x !== undefined && opts.y !== undefined ? { x: opts.x, y: opts.y } : this.freeSlot(null, size.w, size.h);
    const s: StoredSession = {
      id: randomUUID(),
      projectId: opts.projectId,
      folderId: opts.folderId,
      cwd: opts.cwd,
      agent: opts.agent,
      role: opts.role ?? 'player',
      title: opts.title?.trim() || def.label,
      color: opts.color ?? def.color,
      status: opts.resumeId ? 'hibernated' : 'done',
      createdAt: now,
      updatedAt: now,
      x: pos.x,
      y: pos.y,
      w: size.w,
      h: size.h,
      cols: 100,
      rows: 30,
      ...(opts.resumeId ? { resumeId: opts.resumeId } : {})
    };
    if (opts.command) s.command = opts.command;
    if (opts.args) s.args = opts.args;
    this.buffers.set(s.id, '');
    this.save(s);
    return this.publicSession(s);
  }

  input(id: string, data: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.sinceInput = '';
    live.proc.write(data);
  }

  /** Output since the last input (empty when not running). */
  outputSinceInput(id: string): string {
    return this.live.get(id)?.sinceInput ?? '';
  }

  setRole(id: string, role: SessionRole): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    s.role = role;
    this.save(s);
  }

  setOrder(id: string, order: number): void {
    const s = this.sessions.get(id);
    if (!s || s.order === order) return;
    s.order = order;
    this.save(s, false);
  }

  /** Into another project / part (its working folder stays: the folder is registered there too). */
  moveTo(id: string, projectId: string, folderId: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    s.projectId = projectId;
    s.folderId = folderId;
    this.save(s);
  }

  isLive(id: string): boolean {
    return this.live.has(id);
  }

  /** Type a message into the session as one bracketed paste, then press Enter (so newlines don't submit early). */
  paste(id: string, text: string, submit = true): void {
    const live = this.live.get(id);
    if (!live) throw new Error('Session is not running');
    live.sinceInput = '';
    live.proc.write(`\x1b[200~${text.replace(/\r\n?/g, '\n')}\x1b[201~`);
    if (submit) {
      // Codex folds fast input into one paste and takes an Enter inside that burst as a newline: wait until the paste
      // has landed (longer for longer text) before submitting
      const s = this.sessions.get(id);
      const delay = s?.agent === 'codex' ? Math.min(3000, 600 + text.length) : 150;
      setTimeout(() => {
        if (this.live.get(id) === live) live.proc.write('\r');
      }, delay);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    cols = Math.max(2, Math.floor(cols));
    rows = Math.max(1, Math.floor(rows));
    if (s.cols === cols && s.rows === rows) return;
    s.cols = cols;
    s.rows = rows;
    try {
      this.live.get(id)?.proc.resize(cols, rows);
    } catch (e) {
      log.warn('resize failed', id, e);
    }
    this.store.upsertSession(s); // layout change; no broadcast needed
  }

  stop(id: string): void {
    this.live.get(id)?.proc.write('\x03');
  }

  private killProc(live: Live): void {
    try {
      if (process.platform === 'win32') live.proc.kill();
      else live.proc.kill('SIGKILL');
    } catch (e) {
      log.warn('kill failed', e);
    }
  }

  kill(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.intent = 'kill';
    this.killProc(live);
  }

  restart(id: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    const live = this.live.get(id);
    if (live) {
      live.intent = 'restart'; // onExit re-spawns
      this.killProc(live);
      return;
    }
    this.spawn(s, 'fresh');
  }

  private safeSpawn(s: StoredSession, mode: 'fresh' | 'resume'): void {
    try {
      this.spawn(s, mode);
    } catch (e) {
      log.warn('spawn failed', s.id, e);
    }
  }

  resume(id: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (this.live.has(id)) return;
    this.spawn(s, s.resumeId ? 'resume' : 'fresh');
  }

  hibernate(id: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    const live = this.live.get(id);
    if (!live) {
      if (s.status !== 'hibernated' && s.resumeId) {
        this.setStatus(s, 'hibernated');
      }
      return;
    }
    if (!s.resumeId && s.agent === 'claude') {
      const found = findClaudeResumeId(s.cwd, live.startedAt);
      if (found) s.resumeId = found;
    }
    if (!s.resumeId) {
      throw new Error('Cannot hibernate: resume ID is not known yet');
    }
    live.intent = 'hibernate';
    this.killProc(live);
  }

  update(id: string, patch: Partial<Pick<Session, 'title' | 'color' | 'x' | 'y' | 'w' | 'h'>>): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (patch.title !== undefined) s.title = patch.title;
    if (patch.color !== undefined) s.color = patch.color;
    if (patch.x !== undefined) s.x = patch.x;
    if (patch.y !== undefined) s.y = patch.y;
    if (patch.w !== undefined) s.w = patch.w;
    if (patch.h !== undefined) s.h = patch.h;
    this.save(s);
  }

  remove(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const live = this.live.get(id);
    if (live) {
      live.intent = 'remove';
      if (live.quietTimer) clearTimeout(live.quietTimer);
      this.killProc(live);
    }
    this.sessions.delete(id);
    this.buffers.delete(id);
    this.waitingSince.delete(id);
    this.store.removeSession(id);
    try {
      fs.rmSync(this.logPath(id), { force: true });
    } catch {
      /* ignore */
    }
    this.emit('removed', id);
  }

  /** Called every 60 s: hibernate sessions that have been waiting for a long time with no UI attached. */
  private autoHibernateTick(): void {
    const limit = AUTO_HIBERNATE_MIN * 60_000;
    const now = Date.now();
    for (const [id, since] of this.waitingSince) {
      const s = this.sessions.get(id);
      if (!s || s.status !== 'waiting' || !this.live.has(id)) continue;
      if (now - since < limit) continue;
      if (this.isAttached(id)) continue;
      try {
        this.hibernate(id);
        log.info('auto-hibernated', id);
      } catch {
        /* no resume id — keep running */
      }
    }
  }

  /** Kill all processes (daemon shutdown with killSessions). */
  killAll(): void {
    for (const [id, live] of this.live) {
      live.intent = 'kill';
      if (live.quietTimer) clearTimeout(live.quietTimer);
      const s = this.sessions.get(id);
      if (s) {
        s.status = s.resumeId ? 'hibernated' : 'done';
        s.pid = undefined;
        s.updatedAt = Date.now();
        this.store.upsertSession(s);
      }
      this.killProc(live);
      live.logStream?.end();
    }
    this.live.clear();
    this.closed = true;
  }

  private closed = false;

  dispose(): void {
    if (this.hibernateTimer) clearInterval(this.hibernateTimer);
    this.hibernateTimer = null;
  }
}

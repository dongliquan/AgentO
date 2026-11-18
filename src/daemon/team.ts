/**
 * Sessions working together. Every session is equal (no hierarchy): a session asks another session of its project
 * for something and gets the answer back. The user works with any session directly.
 *
 * Sessions reach this daemon's MCP endpoint (POST http://127.0.0.1:<port>/mcp/<sessionId>, Streamable HTTP with
 * JSON responses); every session sees the same tools.
 *
 * Messages between sessions go through an outbox: delivered as one bracketed paste when the target is idle, held while
 * it works or sits on a permission/trust prompt. When a directed session finishes, whoever sent the directive gets an
 * automatic report with its last reply (the user's orders are reported to the inbox).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatEntry, Project, Session } from '@shared/protocol';
import type { Store, StoredSession } from './store';
import type { SessionManager } from './sessions';
import { attachmentsDir, dataDir, ensureDir } from './paths';
import { TranscriptParser, findTranscript, readTranscriptLines } from './transcript';
import { log } from './log';
import { plainTerminalLines } from '@shared/plaintext';
import { LIMIT_RE, PROMPT_RE, limitResetText } from '@shared/prompts';
import { findCodexRollout, readCodex } from './codex';
import { Ledger } from './ledger';
import { MEMORY_MODES_HELP, MEMORY_SECTIONS, MEMORY_TOOL_DESCRIPTION, ensureMemory, memorySystemPrompt, updateMemory, type MemoryMode, type MemorySection } from './memory';
import { AUTO_MIN_GAP_MS, AUTO_FRESH, AUTO_IDLE_MS, AUTO_MIN_CONTEXT, HANDOFF_CONTINUE, HANDOFF_REQUEST, conversationStart, handoffDir, handoffPath, AUTO_OVERSIZE_FACTOR, AUTO_OVERSIZE_IDLE_MS, AUTO_MANAGER_QUIET_MS, HANDOFF_MARK } from './freshstart';

export const MCP_SERVER_NAME = 'agento';
const MAX_BODY = 1024 * 1024;
const MAX_WAIT_S = 600;
/** Team traffic is recorded in full (the Log tab shows it) up to this length. */
const LOG_TEXT_MAX = 4000;

/** The model a Claude session starts with unless one was picked (env AGENTO_PLAYER_MODEL; empty = Opus 5.5, never the CLI default). */
const envOr = (k: string, d: string): string => (process.env[k] !== undefined ? process.env[k]!.trim() : d);
const PLAYER_MODEL = envOr('AGENTO_PLAYER_MODEL', 'claude-opus-5-5') || 'claude-opus-5-5';
/** Per-call tool timeout given to the CLIs: longer than the longest wait_for_sessions. */
const TOOL_TIMEOUT_S = MAX_WAIT_S + 60;
/** Codex reads the bearer token for the MCP endpoint from this env var (set per launch). */
const TOKEN_ENV = 'AGENTO_MCP_TOKEN';
/** A directive counts as "not picked up yet" for this long if the session never starts working. */
const PICKUP_GRACE_MS = 20_000;
/** the crash-loop guard: at most WAKE_MAX wakes of one session within WAKE_WINDOW_MS */
const WAKE_MAX = 3;
const WAKE_WINDOW_MS = 3 * 60_000;
/** No delivery for this long after a session starts, or after its folder-trust prompt was answered. */
const START_SETTLE_MS = 5_000;
const TRUST_SETTLE_MS = 8_000;
/** Waiting must hold this long before a directed session counts as finished (status flips on output pauses). */
const SETTLE_MS = 4_000;
/** Autopilot: the lead session resting this long with nothing out is told to carry on; limits so it cannot spin */
const AUTOPILOT_SETTLE_MS = 15_000;
/** a session woken after being stopped this long is told how long it was away */
const STOPPED_NOTE_MS = 20 * 60_000;
const AUTOPILOT_MAX_PER_HOUR = 6;
const AUTOPILOT_MAX_IDLE = 2;
/** Autopilot: one session does the work itself, one open piece at a time */
const AUTOPILOT_RULES_SOLO =
  '[AgentO Autopilot] The manager is away; keep working on this project without them.\n' +
  '- Do not stop to ask the manager. When a decision is open, choose the option you recommend, do it, and record it with `update_memory` (section Decisions, one line: what and why). Say it in your answer as "Assumed: …" — do not wait for an answer.\n' +
  '- Only what nobody but the manager can do (credentials, passwords, access to production, destructive or irreversible actions) is skipped: add one line to the memory section Open ("Manager: …") and carry on with the other work.\n' +
  '- Do the work yourself, one open piece at a time: build or test each piece before the next, and remove its line from the memory section Open with `update_memory` when it is finished and checked. Never end your answer with a question.\n' +
  '- Work only on what is still open. Never repeat or summarize finished work.\n' +
  '- When nothing is open any more, answer with only the line `AUTOPILOT DONE`. When the whole plan was finished and checked in this run, say what is new in a few lines first, and end your answer with `AUTOPILOT DONE`.';
/** a rider (a note that only goes along with another message) is delivered on its own after this long */
const RIDE_MAX_MS = 15 * 60_000;
/** Messages a session may send per window — stops two sessions from bouncing messages forever. */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT = 12;
/** Shown as the sender of the user's orders. */
const USER = 'the manager (the user)';
/** sender of what the user types into a session directly (the renderer tells these from orders by it) */
const DIRECT = 'Manager (you) · Direct';

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
  run: (caller: StoredSession, args: Json) => Promise<string> | string;
}

interface Pending {
  /** session id of the sender, or 'user' */
  from: string;
  /** earlier senders still waiting for this session's result (a second directive arrived before it finished) */
  also?: string[];
  at: number;
  started: boolean;
  timer: NodeJS.Timeout | null;
  /** the manager was already told it is stuck on a prompt */
  blocked?: boolean;
  /** it sent a directive to someone while on this order: a turn that ends then is a hand-off, not a result */
  delegated?: boolean;
  /** the piece of work ("#T12") this directive is */
  task?: string;
  /** the text typed for it (resent once if the session did not take it) */
  text?: string;
  /** it was resent already */
  resent?: boolean;
}

interface Queued {
  text: string;
  /** set when this is a directive (its completion is reported back to the sender) */
  from?: string;
  /** false: a note that waits for the session's next work instead of waking it (e.g. an FYI) */
  wake?: boolean;
  /** never delivered on its own, even to an idle session: it goes along with the next message that is (saves a turn) */
  ride?: boolean;
  /** when it was queued (a rider waits at most RIDE_MAX_MS) */
  at?: number;
  /** a report / answer (not a directive) */
  report?: boolean;
  /** a directive's task id (becomes the pending work's id when delivered) */
  task?: string;
  /** a rider that is dropped, not delivered on its own, once this time passes (an FYI nobody needed) */
  expires?: number;
  /** a later item with the same key replaces this one (its `lines` kept) — so FYIs about one thing stay one note */
  key?: string;
  lines?: string[];
}

class ToolError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s);

/** Strip ANSI/OSC sequences and carriage-return overdraws from raw terminal output. */
/** The user picked a Codex Windows sandbox mode themselves ([windows] sandbox = … in ~/.codex/config.toml). */
function codexSandboxChosen(): boolean {
  const home = process.env['CODEX_HOME'] || path.join(process.env['USERPROFILE'] || process.env['HOME'] || '', '.codex');
  try {
    const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    return /^\s*\[windows\][^[]*^\s*sandbox\s*=/m.test(toml);
  } catch {
    return false;
  }
}

/** Terminal output as plain text: cursor moves become spacing (Claude Code's TUI positions words with CSI n G/C). */
function plainTerminal(raw: string): string {
  return plainTerminalLines(raw)
    .filter((l, i, a) => l.trim() !== '' || (i > 0 && a[i - 1]?.trim() !== ''))
    .join('\n');
}

/** A permission, trust or choice prompt is on screen: typing into it would answer it. */
// PROMPT_RE: a question on screen waiting for the user (shared with SessionManager's `attention`)

function chatLine(e: ChatEntry): string | null {
  switch (e.kind) {
    case 'user':
      return `USER: ${clip(e.text ?? '', 2000)}`;
    case 'assistant':
      return `ASSISTANT: ${clip(e.text ?? '', 4000)}`;
    case 'system':
      return `SYSTEM: ${clip(e.text ?? '', 500)}`;
    case 'tool': {
      if (!e.tool) return null;
      const input = clip(JSON.stringify(e.tool.input), 300);
      const state = e.tool.done ? (e.tool.isError ? 'error' : 'done') : 'running';
      const result = e.tool.result ? `\n  → ${clip(e.tool.result.replace(/\s+/g, ' '), 400)}` : '';
      return `TOOL ${e.tool.name} ${input} [${state}]${result}`;
    }
    default:
      return null; // thinking
  }
}

function projectName(id: string, projects: Project[]): string {
  return projects.find((x) => x.id === id)?.name ?? '(deleted project)';
}

/** Optional CLI dialogs AgentO closes with Esc (they would swallow team messages as keystrokes). */
const OPTIONAL_DIALOGS = [/Teach\s*auto\s*mode\s*about\s*your\s*environment/i];

const PLAYER_INSTRUCTIONS = `AgentO tools. Other sessions of this project run beside you.
- list_sessions shows them; read_session shows what one of them is doing or did; send_to_session asks one of them for something — its answer comes back to you as an "[AgentO] … finished" message, so do not wait for it.
- Messages from other sessions arrive as text starting with "[Message from …]" or "[AgentO] …". Each carries an id like #T12: quote it when you answer about that request.
- Whoever sent you a request is told automatically when you finish, so ending your answer is the report. Use report_up only when you are blocked or need a decision.
- When you learn something every session of the project needs — a convention, where something is, a trap — add one line to the project memory with update_memory (Conventions / Map / Don't); it is given to every session at start.`;

export class Team {
  /** when each session was woken for queued messages lately (the crash-loop guard) */
  private wakes = new Map<string, number[]>();
  /** when a stopped session that is being woken for a message had stopped (its first message tells it how long ago) */
  private stoppedSince = new Map<string, number>();
  /** sessions the guard stopped waking (cleared when the session runs again) */
  private wakeStopped = new Set<string>();
  /** sessions that were sent a directive, keyed by target */
  private pending = new Map<string, Pending>();
  /** every piece of work handed out (#T) and the state the daemon saw it in */
  readonly ledger: Ledger;
  /** stopped sessions the user just typed into (note() before message()): their queued message is tracked like an order */
  private directNext = new Set<string>();
  /** who received the latest order (a routine remembers them to skip a run while they are still on the last one) */
  lastRecipients: string[] = [];

  /** The queues as last saved: messages not delivered yet, who waits for whose result, who to report_up to. */
  private saved = '';
  private persist(): void {
    const state = {
      outbox: [...this.outbox],
      pending: [...this.pending].map(([id, p]) => [id, { from: p.from, also: p.also, at: p.at, blocked: p.blocked, delegated: p.delegated, task: p.task, text: p.text, resent: p.resent }]),
      director: [...this.director]
    };
    const json = JSON.stringify(state);
    if (json === this.saved) return;
    this.saved = json;
    try {
      this.store.setKv('team', state);
    } catch (e) {
      log.warn('team: could not save the queues', e);
    }
  }

  /** After a restart: the queues come back (a pending result waits for the session's next finished turn). */
  private restore(): void {
    type Saved = { outbox: [string, Queued[]][]; pending: [string, { from: string; also?: string[]; at: number; blocked?: boolean; delegated?: boolean; task?: string; text?: string; resent?: boolean }][]; director: [string, string][] };
    const st = this.store.getKv<Saved>('team');
    if (!st) return;
    for (const [id, q] of st.outbox ?? []) if (this.sessions.get(id) && q.length) this.outbox.set(id, q);
    for (const [id, p] of st.pending ?? []) if (this.sessions.get(id)) this.pending.set(id, { ...p, started: false, timer: null });
    for (const [id, from] of st.director ?? []) if (this.sessions.get(id)) this.director.set(id, from);
    this.saved = JSON.stringify(st);
    if (this.outbox.size || this.pending.size) log.info('team: restored', this.outbox.size, 'queued,', this.pending.size, 'waiting for results');
  }

  /** Messages waiting for the session other than riders (which only go along with something else). */
  private hasMail(id: string): boolean {
    return (this.outbox.get(id) ?? []).some((q) => !q.ride);
  }

  /** fresh starts under way: the handoff note asked for, and when */
  private fresh = new Map<string, { file: string; at: number; why: 'manual' | 'auto'; timer: NodeJS.Timeout | null; started: boolean }>();
  /** messages waiting until their target is idle */
  private outbox = new Map<string, Queued[]>();
  /* autopilot (memory only): the lead session's settle timer, the last team traffic per project, the run's bookkeeping */
  private apTimers = new Map<string, NodeJS.Timeout>();
  private apActive = new Map<string, number>();
  private apRun = new Map<string, { at: number; idle: number; window: number[] }>();
  /** targets the user was already told about (sitting on a prompt) */
  private attention = new Set<string>();
  /** targets we already tried to resume for queued messages */
  private resuming = new Set<string>();
  /** send timestamps per caller (rate limit) */
  private sent = new Map<string, number[]>();
  /** called after a team message was typed into a session (the UI replays it in the card's message box) */
  onDelivered: (sessionId: string, text: string) => void = () => {};
  /** called after the project list changed (a session moved, a closed project opened) */
  onProjects: () => void = () => {};
  /** who gave each session its latest directive (session id or 'user') — report_up goes back there */
  private director = new Map<string, string>();

  constructor(
    private store: Store,
    private sessions: SessionManager,
    private conn: { port: number; token: string; version: string },
    /** called after inbox rows were added */
    private onInbox: () => void
  ) {
    sessions.on('upsert', (s) => {
      this.onStatus(s);
      this.onFreshStatus(s);
    });
    // a Fresh start in progress, or a question / blocked task that waits for the manager, keeps the session awake
    sessions.keepAwake = (id) => this.fresh.has(id) || this.ledger.openOf(id).some((r) => r.state === 'asking' || r.state === 'blocked');
    // every 2 minutes (an oversized conversation waits only a short pause; the others still need 25 idle minutes)
    if (AUTO_FRESH) setInterval(() => this.autoFresh(), 2 * 60_000).unref?.();
    sessions.on('data', (id) => {
      this.autoTrust(id);
      this.autoDismiss(id);
    });
    // Waiting is the normal resting state inside team work; the user hears about it through reports instead.
    // Waiting is the normal resting state of a session that took part in a request: its sender hears about it instead.
    sessions.quietWaiting = (s) => this.pending.has(s.id) || this.outbox.has(s.id);
    this.ledger = new Ledger(store);
    this.restore();
    this.reconcileLedger();
    // a daemon that restarted while the lead session was resting: no status event comes, so look every 2 minutes
    setInterval(() => this.autopilotSweep(), 2 * 60_000).unref();
    setInterval(() => {
      this.flush();
      this.persist();
    }, 1500).unref();
  }

  /* ---------- folder trust ---------- */

  /** session id + pid already answered (one answer per process) */
  private trustAnswered = new Set<string>();
  /** no delivery before this time: a just-started CLI or one that just got past the trust prompt is not ready yet */
  private notBefore = new Map<string, number>();

  /** Folders AgentO created (team/…) and project folders registered with autoTrust (the demo setup). */
  private trustable(s: StoredSession): boolean {
    const team = path.resolve(this.teamDir()).toLowerCase();
    if (path.resolve(s.cwd).toLowerCase().startsWith(team)) return true;
    return s.folderId ? this.store.getFolder(s.folderId)?.autoTrust === true : false;
  }

  /**
   * Answer the folder-trust prompt with "trust", for trustable folders only:
   * - claude: "Do you trust the files in this folder?" — No is selected, so Down + Enter
   * - codex:  "Trust this folder?" — "1. Trust and continue" is selected, so Enter
   */
  private autoTrust(id: string): void {
    const s = this.sessions.get(id);
    if (!s || (s.agent !== 'claude' && s.agent !== 'codex') || !s.pid) return;
    const key = `${id}:${s.pid}`;
    // cheap checks first: this runs on every output chunk
    const out = this.sessions.outputSinceInput(id);
    // every Claude session is started with AgentO's attachments folder (and a session outside its project's folders with those folders): the
    // "Adding a new directory" question can come up in any of them, whatever folder the session works in
    if (s.agent === 'claude' && /new\s*directory/i.test(out)) this.autoAddDir(id, s, out);
    if (!this.trustable(s)) return;
    if (this.trustAnswered.has(key)) return;
    if (!/trust/i.test(out)) return;
    const screen = plainTerminal(out);
    const prompt = s.agent === 'claude' ? /Yes, I trust this folder/ : /Trust\s*and\s*continue/;
    if (!prompt.test(screen)) return;
    this.trustAnswered.add(key);
    this.notBefore.set(id, Date.now() + TRUST_SETTLE_MS);
    setTimeout(() => {
      if (s.agent === 'claude') {
        this.sessions.input(id, '\x1b[B');
        setTimeout(() => this.sessions.input(id, '\r'), 300);
      } else this.sessions.input(id, '\r');
    }, 600);
    log.info('team: accepted folder trust for', s.title, s.cwd);
  }

  /**
   * Claude Code asks "Adding a new directory: <dir> … No, exit / Yes, add it" for every extra folder it is started with
   * (--add-dir). Left open it holds the session for good and swallows every message.
   * Said yes for AgentO's own folders and the folders the manager registered (or below one), in any Claude session; anything else is left to the manager.
   */
  private autoAddDir(id: string, s: StoredSession, out: string): void {
    const screen = plainTerminal(out);
    const m = /Adding a new directory:\s*(\S.*?)\s*(?:This session|$)/im.exec(screen);
    if (!m || !/Yes, add it/.test(screen)) return;
    // the screen text has lost its spaces ("AgentOProjects"): compare without them
    const squash = (p: string): string => path.resolve(p).toLowerCase().replace(/\s+/g, '');
    const dir = squash(m[1]!);
    const roots = this.store.listProjects().flatMap((p) => p.folders.map((f) => squash(f.path)));
    roots.push(squash(path.join(os.homedir(), 'AgentO Projects')), squash(dataDir()));
    const known = roots.some((root) => dir === root || dir.startsWith(root + path.sep));
    if (!known) return;
    const key = `${id}:${s.pid}:add:${dir}`;
    if (Date.now() - (this.dismissed.get(key) ?? 0) < 30_000) return;
    this.dismissed.set(key, Date.now());
    this.notBefore.set(id, Date.now() + TRUST_SETTLE_MS);
    // the cursor starts on "No, exit": ↓ to "Yes, add it", then Enter (a number key does nothing here)
    setTimeout(() => {
      this.sessions.input(id, '\x1b[B');
      setTimeout(() => this.sessions.input(id, '\r'), 300);
    }, 500);
    log.info('team: added directory for', s.title, dir);
  }

  /** when each dialog was last dismissed in a session's process (it may come back: dismissed again after a minute) */
  private dismissed = new Map<string, number>();

  /**
   * Close optional dialogs a CLI shows on its own (Claude Code's "Teach auto mode about your environment?"): left open
   * they swallow every message typed in as keystrokes, and the session never gets them. Esc cancels them.
   */
  private autoDismiss(id: string): void {
    const s = this.sessions.get(id);
    if (!s || s.agent !== 'claude' || !s.pid) return;
    const out = this.sessions.outputSinceInput(id);
    // cheap check first: this runs on every output chunk
    if (!/auto\s*mode/i.test(out)) return;
    const screen = plainTerminal(out);
    const dialog = OPTIONAL_DIALOGS.find((d) => d.test(screen));
    if (!dialog) return;
    const key = `${id}:${s.pid}:${dialog.source}`;
    if (Date.now() - (this.dismissed.get(key) ?? 0) < 60_000) return;
    this.dismissed.set(key, Date.now());
    this.notBefore.set(id, Date.now() + TRUST_SETTLE_MS);
    setTimeout(() => this.sessions.input(id, '\x1b'), 400);
    log.info('team: closed an optional CLI dialog for', s.title, dialog.source);
  }

  /** When the session last took a message (its newest user turn in the transcript); undefined without a transcript. */
  private lastTakenAt(s: StoredSession): number | undefined {
    const entries = this.chat(s);
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'user') return entries[i]!.ts;
    return undefined; // none in the part read (a huge transcript's tail): unknown, not "never took it"
  }

  /* ---------- lookups ---------- */

  private all(): StoredSession[] {
    // was list() (a public copy of every session) mapped back to the stored ones — on every scope check and routing step
    return this.sessions.stored();
  }

  private project(id: string): Project | undefined {
    return this.store.listProjects().find((p) => p.id === id);
  }

  /** A new task id for work sent to this session: numbered per project, "#T<n>" (a session outside any project: a shared counter). */
  private newTask(target: StoredSession): string {
    return this.store.nextTaskId(this.project(target.projectId)?.id ?? 'team');
  }

  /** The task a session is on right now (its pending directive), for the messages it sends about it. */
  private taskOf(sessionId: string): string | undefined {
    return this.pending.get(sessionId)?.task;
  }

  /* ---------- task ledger ---------- */

  /** The ledger project key of a session's work: its project ('' when it has none). */
  private ledgerProject(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    return s ? this.project(s.projectId)?.id ?? '' : '';
  }

  /** A task was handed to `target` (by a session or 'user'). */
  private openTask(task: string, from: string, target: StoredSession, text: string): void {
    const projectId = this.project(target.projectId)?.id ?? '';
    const body = text.replace(/^\s*\[[^\]\n]{0,160}\]\s*/, '').replace(/\*\*|`/g, '');
    const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const parentTask = from !== 'user' ? this.taskOf(from) : undefined;
    this.ledger.open({
      id: task,
      projectId,
      from,
      to: target.id,
      summary: first.length > 140 ? `${first.slice(0, 139)}…` : first,
      createdAt: Date.now(),
      ...(parentTask ? { parent: Ledger.key(this.ledgerProject(from), parentTask) } : {})
    });
  }

  private taskState(sessionId: string, task: string | undefined, state: Parameters<Ledger['set']>[2], note?: string): void {
    this.ledger.set(this.ledgerProject(sessionId), task, state, note);
  }

  /** After a restart: a task that is neither being worked on nor waiting in a queue lost its trail — settle it. */
  private reconcileLedger(): void {
    for (const r of this.ledger.list()) {
      if (r.state === 'reported' || r.state === 'asking' || r.state === 'handed') continue;
      const queued = (this.outbox.get(r.to) ?? []).some((q) => q.task === r.id);
      if (this.pending.get(r.to)?.task === r.id || queued) continue;
      this.ledger.set(r.projectId, r.id, 'reported', 'no trace of it after a restart');
    }
  }

  /** The session got an answer / new work: what it was asking is settled. */
  private answered(sessionId: string): void {
    for (const r of this.ledger.openOf(sessionId)) if (r.state === 'asking') this.ledger.set(r.projectId, r.id, 'reported', 'answered');
  }

  /* ---------- folders, creation, launch ---------- */

  private teamDir(): string {
    return ensureDir(path.join(dataDir(), 'team'));
  }

  /**
   * A project is being deleted: forget its sessions' queues, and remove what AgentO made for it — the sessions' MCP
   * configs and the folders of its 1.x coaches under the app's team folder. The project's own folders
   * (the user's code) and the CLIs' conversation files are never touched.
   */
  forgetProject(projectIds: string[], sessionIds: string[]): void {
    for (const id of projectIds) this.ledger.forgetProject(id);
    for (const id of sessionIds) {
      this.outbox.delete(id);
      this.pending.delete(id);
      this.director.delete(id);
      const f = this.fresh.get(id);
      if (f?.timer) clearTimeout(f.timer);
      this.fresh.delete(id);
      try {
        fs.rmSync(path.join(this.teamDir(), 'mcp', `${id}.json`), { force: true });
      } catch {
        /* ignore */
      }
    }
    for (const [target, from] of this.director) if (sessionIds.includes(from)) this.director.delete(target);
    const team = path.resolve(this.teamDir());
    for (const pid of projectIds) {
      for (const name of [`head-${pid}`, `coach-${pid}`]) {
        const dir = path.join(team, name);
        // only folders AgentO made inside its own team folder
        if (path.dirname(path.resolve(dir)) !== team) continue;
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
          log.warn('team: could not remove', dir, e);
        }
      }
    }
  }

  /**
   * 1.x wrote role instructions ("# Role: Head Coach …") into its coaches' folders under the app's team folder; a
   * former coach that resumes there would still read itself as one. The files AgentO generated (first line the
   * marker) are removed; a file the user took over (marker line deleted) stays.
   */
  removeTeamInstructions(): void {
    const team = this.teamDir();
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(team).filter((n) => /^(?:head|coach)-/.test(n));
    } catch {
      return;
    }
    for (const d of dirs) {
      for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
        const file = path.join(team, d, name);
        try {
          if (fs.readFileSync(file, 'utf8').startsWith('<!-- agento:generated')) {
            fs.rmSync(file, { force: true });
            log.info('team: removed the 1.x role instructions', file);
          }
        } catch {
          /* no such file */
        }
      }
    }
  }

  /** The session's project is closed: nothing wakes it or is delivered to it. */
  isClosed(projectId: string): boolean {
    if (!projectId) return false;
    return this.store.listProjects().some((p) => p.id === projectId && p.closed === true);
  }

  /**
   * Move a session into a project (keeping its folder and conversation; the folder is registered there), and put it
   * before `beforeId` among that project's sessions (else last). Same project: only the order changes.
   */
  moveSession(id: string, destId: string, beforeId?: string): void {
    const t = this.sessions.get(id);
    const projects = this.store.listProjects();
    const dest = projects.find((p) => p.id === destId);
    if (!t || !dest) throw new Error('Session or project not found');
    if (t.projectId !== dest.id) {
      if (!t.folderId) throw new Error(`"${t.title}" has no folder and cannot be moved`);
      const path0 = projects.flatMap((p) => p.folders).find((f) => f.id === t.folderId)?.path;
      if (!path0) throw new Error(`The folder of "${t.title}" is not registered`);
      const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
      const folder = dest.folders.find((f) => same(f.path, path0)) ?? this.store.addFolder(dest.id, path0, path.basename(path0) || path0);
      this.sessions.moveTo(t.id, dest.id, folder.id);
      this.onProjects();
    }
    // the project's order: the moved one put before `beforeId`
    const key = (s: StoredSession): number => s.order ?? Number.MAX_SAFE_INTEGER;
    const members = this.all()
      .filter((s) => s.projectId === dest.id && s.id !== id)
      .sort((a, b) => key(a) - key(b) || a.createdAt - b.createdAt);
    const at = beforeId ? members.findIndex((s) => s.id === beforeId) : -1;
    members.splice(at >= 0 ? at : members.length, 0, this.sessions.get(id)!);
    members.forEach((s, i) => this.sessions.setOrder(s.id, i + 1));
  }

  /** The user's own message to a session (not an order): woken if stopped, typed in once it is ready. */
  message(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (this.isClosed(s.projectId)) throw new Error('That project is closed — open it first');
    if (!text.trim()) return;
    // typed by the user into a stopped session: its answer is reported like an order's (see note())
    const direct = this.directNext.delete(id) && !this.pending.has(id);
    this.enqueue(id, direct ? { text: text.trim(), from: 'user' } : { text: text.trim() });
  }

  /**
   * The user typed into a session directly (not an order): recorded as a directive from 'Manager (you) · Direct', and
   * the session's reply reported back like an order's — unless it is still on someone's directive, whose report it
   * must not take over (its answer then stays in its conversation and in that report).
   */
  note(id: string, text: string): void {
    const s = this.sessions.get(id);
    if (!s || !text.trim()) return;
    const task = this.newTask(s);
    this.openTask(task, 'user', s, text);
    // typed right now into a running session (not queued behind anything)
    if (this.sessions.isLive(id)) this.taskState(id, task, 'working');
    this.answered(id);
    this.record(s, 'directive', { id: 'user', title: DIRECT }, text, true, task);
    if (this.pending.has(id)) return;
    // stopped: message() queues it and wakes the session; it is tracked when delivered
    if (!this.sessions.isLive(id)) {
      this.directNext.add(id);
      return;
    }
    this.trackDirective(id, 'user', task);
    // the composer types before it reports the note: the turn may already be running
    const p = this.pending.get(id);
    if (p && (s.status === 'working' || s.status === 'starting')) p.started = true;
  }

  /**
   * Fresh start (see freshstart.ts): ask for the handoff note now; when the note is written and the session is idle,
   * start it over with the note as its first message. A busy session is refused (manual) or skipped (auto).
   */
  freshStart(id: string, why: 'manual' | 'auto'): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (s.agent !== 'claude') throw new Error('Fresh start works with Claude sessions');
    if (this.fresh.has(id)) throw new Error('A fresh start is already under way for this session');
    if (this.isClosed(s.projectId)) throw new Error('That project is closed — open it first');
    if (s.status === 'working' || s.status === 'starting' || this.pending.has(id) || this.hasMail(id))
      throw new Error(`${s.title} is busy — fresh start it when it is idle`);
    if (!s.resumeId) throw new Error('This session has no conversation yet');
    const file = handoffPath(s);
    const timer = setTimeout(() => {
      if (this.fresh.get(id)?.file !== file) return;
      this.fresh.delete(id);
      // the request must not arrive later on its own
      const q = this.outbox.get(id)?.filter((m) => m.text !== HANDOFF_REQUEST);
      if (q?.length) this.outbox.set(id, q);
      else this.outbox.delete(id);
      this.store.addInbox(id, 'error', `${s.title} — fresh start gave up: no handoff note after 15 minutes`);
      this.onInbox();
    }, 15 * 60_000);
    this.fresh.set(id, { file, at: Date.now(), why, timer, started: false });
    log.info('team: fresh start', why, s.title, file);
    this.enqueue(id, { text: HANDOFF_REQUEST });
  }

  private onFreshStatus(s: Session): void {
    const f = this.fresh.get(s.id);
    if (!f) return;
    // the request was delivered and the session is answering it
    if (s.status === 'working') f.started = !this.outbox.has(s.id) || f.started;
    if (s.status !== 'waiting' || !f.started) return;
    // the answer may still be finishing: wait for the idle to hold, then take it as the note
    setTimeout(() => {
      const cur = this.sessions.get(s.id);
      if (!cur || this.fresh.get(s.id) !== f || cur.status !== 'waiting') return;
      const note = this.lastReply(cur, 200_000).trim();
      if (note.length < 200) return; // not the note yet (a short acknowledgement): wait for the real answer
      try {
        fs.writeFileSync(f.file, `${note}\n${this.lastExchange(cur)}`);
      } catch (e) {
        log.warn('team: could not save the handoff note', f.file, e);
        return;
      }
      this.fresh.delete(s.id);
      if (f.timer) clearTimeout(f.timer);
      const before = cur.context;
      this.sessions.restart(s.id, HANDOFF_CONTINUE(f.file));
      this.store.addInbox(
        s.id,
        'done',
        `${cur.title} — fresh start${f.why === 'auto' ? ' (auto)' : ''}: new conversation from the handoff note${before ? ` (was ${Math.round(before / 1000)}K tokens)` : ''} · ${f.file}`
      );
      this.onInbox();
    }, SETTLE_MS);
  }

  /**
   * The old conversation's last request and answer, word for word, for the end of the handoff note — the note is a
   * summary; this keeps exactly what was being worked on when the fresh start came (no tokens to write it).
   */
  private lastExchange(s: StoredSession): string {
    const entries = this.chat(s);
    if (!entries) return '';
    const mark = entries.map((e) => e.kind === 'user' && (e.text ?? '').includes(HANDOFF_MARK)).lastIndexOf(true);
    const before = mark >= 0 ? entries.slice(0, mark) : entries;
    const lastUser = before.map((e) => e.kind === 'user' && !!(e.text ?? '').trim()).lastIndexOf(true);
    if (lastUser < 0) return '';
    const ask = (before[lastUser]!.text ?? '').trim();
    const said = before.slice(lastUser + 1).filter((e) => e.kind === 'assistant' && (e.text ?? '').trim()).map((e) => e.text!.trim()).join('\n\n');
    const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}\n…(${t.length - n} more characters)` : t);
    return `\n---\n\n## Last exchange before the fresh start (word for word)\n\n**Request:**\n\n${clip(ask, 4000)}\n\n**Your answer:**\n\n${clip(said || '(no answer yet)', 6000)}\n`;
  }

  /** Idle Claude sessions whose conversation has grown past the size get a fresh start (checked every 10 minutes). */
  private autoFresh(): void {
    for (const s of this.all()) {
      if (s.agent !== 'claude' || !this.sessions.isLive(s.id) || s.status !== 'waiting') continue;
      if (this.fresh.has(s.id) || this.pending.has(s.id) || this.hasMail(s.id) || this.isClosed(s.projectId)) continue;
      const min = AUTO_MIN_CONTEXT;
      const size = s.context ?? 0;
      if (size < min) continue;
      // oversized: every turn re-reads it — cleared after a short pause, even while the manager uses the session
      const oversized = size >= min * AUTO_OVERSIZE_FACTOR;
      if (this.sessions.idleFor(s.id) < (oversized ? AUTO_OVERSIZE_IDLE_MS : AUTO_IDLE_MS)) continue;
      // otherwise a session the manager has open (Ground card terminal, Session tab) is not cleared under them; and one
      // the manager typed into within the hour never is, whatever its size (the Large chat alert asks them instead)
      if (!oversized && (this.sessions.isAttached(s.id) || this.sessions.inUse(s.id))) continue;
      if (this.sessions.typedAgo(s.id) < AUTO_MANAGER_QUIET_MS) continue;
      if (this.needsAttention(s) || this.limited(s)) continue;
      const began = conversationStart(s.cwd, s.resumeId);
      if (!oversized && began && Date.now() - began < AUTO_MIN_GAP_MS) continue;
      try {
        this.freshStart(s.id, 'auto');
      } catch (e) {
        log.warn('team: auto fresh start skipped', s.title, e);
      }
    }
  }

  private mcpUrl(s: StoredSession): string {
    return `http://127.0.0.1:${this.conn.port}/mcp/${s.id}`;
  }

  /**
   * The project folders a session outside them may read and edit: a session with no project folder of its own (a 1.x
   * coach that runs in a folder under the app's team folder) gets every folder of its project.
   */
  private projectFolders(s: StoredSession): string[] {
    if (s.folderId) return [];
    return (this.project(s.projectId)?.folders ?? []).map((f) => f.path);
  }

  /**
   * Environment per launch: Codex reads the MCP bearer token from TOKEN_ENV.
   */
  launchEnv(s: StoredSession): Record<string, string> {
    if (s.agent === 'codex') return { [TOKEN_ENV]: this.conn.token };
    return {};
  }

  /**
   * Extra CLI args per launch: the MCP connection and (a session outside its project's folders) the project folders.
   * - claude: --mcp-config file, tools pre-allowed
   * - codex:  -c overrides (no quotes or spaces, so they survive Windows command-line quoting); token from env
   * - gemini: settings file .gemini/settings.json — only in a folder AgentO made (it lives in the working folder)
   */
  launchExtras(s: StoredSession): string[] {
    if (s.agent === 'codex') {
      const key = `mcp_servers.${MCP_SERVER_NAME}`;
      return [
        '-c', `${key}.url=${this.mcpUrl(s)}`,
        '-c', `${key}.bearer_token_env_var=${TOKEN_ENV}`,
        '-c', `${key}.default_tools_approval_mode=auto`,
        '-c', `${key}.tool_timeout_sec=${TOOL_TIMEOUT_S}`,
        '-c', `${key}.startup_timeout_sec=20`,
        // it edits code like a Claude session does (no sandbox, the user's own rights): the Windows sandbox
        // ("unelevated") denies writes in large workspaces such as a folder of many repositories
        '-c', 'sandbox_mode=danger-full-access',
        // on Windows, first runs ask which sandbox to set up and wait there; without the user's own choice in
        // ~/.codex/config.toml, take the one that needs no administrator rights
        ...(process.platform === 'win32' && !codexSandboxChosen() ? ['-c', 'windows.sandbox=unelevated'] : []),
        ...(s.modelPref ? ['-c', `model=${s.modelPref}`] : [])
      ];
    }
    if (s.agent === 'gemini') {
      // the settings file lives in the working folder: only in a folder AgentO made, never in the user's project
      if (s.folderId) return [];
      const file = path.join(ensureDir(path.join(s.cwd, '.gemini')), 'settings.json');
      let settings: Json = {};
      try {
        settings = JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
      } catch {
        /* new file */
      }
      const servers = (typeof settings['mcpServers'] === 'object' && settings['mcpServers'] !== null ? settings['mcpServers'] : {}) as Json;
      servers[MCP_SERVER_NAME] = {
        httpUrl: this.mcpUrl(s),
        headers: { Authorization: `Bearer ${this.conn.token}` },
        trust: true,
        timeout: TOOL_TIMEOUT_S * 1000
      };
      settings['mcpServers'] = servers;
      fs.writeFileSync(file, JSON.stringify(settings, null, 2));
      const folders = this.projectFolders(s);
      return folders.length ? ['--include-directories', folders.join(',')] : [];
    }
    if (s.agent !== 'claude') return [];
    const file = path.join(ensureDir(path.join(this.teamDir(), 'mcp')), `${s.id}.json`);
    const config = {
      mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: this.mcpUrl(s), headers: { Authorization: `Bearer ${this.conn.token}` } } }
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    const extras: string[] = [];
    const folders = this.projectFolders(s);
    if (folders.length) extras.push('--add-dir', ...folders);
    // attached images arrive as paths in this folder: readable without a permission prompt
    extras.push('--add-dir', attachmentsDir());
    // fresh start: the handoff note is written here and read back by the new conversation
    extras.push('--add-dir', handoffDir());
    extras.push('--mcp-config', file, '--allowedTools', `mcp__${MCP_SERVER_NAME}`);
    // headless: permission questions come to AgentO through the MCP server (answered by the manager or a trusted folder)
    if (s.mode === 'headless') extras.push('--permission-prompt-tool', `mcp__${MCP_SERVER_NAME}__permission`, '--permission-mode', 'acceptEdits');
    // the project memory: what every session of the project should know, read on every call (kept short by its caps)
    const root = this.project(s.projectId);
    if (root) {
      ensureMemory(root.id, root.name);
      const mem = memorySystemPrompt(root.id, root.name);
      if (mem) extras.push('--append-system-prompt', mem);
    }
    if (s.modelPref || PLAYER_MODEL) extras.push('--model', s.modelPref || PLAYER_MODEL);
    return extras;
  }

  /* ---------- permissions the manager allowed for good ---------- */

  /** per session: everything, or these tools — kept in the DB (kv 'permAllow'), so they survive restarts */
  private permAllow(): Record<string, { all?: boolean; tools?: string[] }> {
    return this.store.getKv<Record<string, { all?: boolean; tools?: string[] }>>('permAllow') ?? {};
  }

  rememberPermission(sessionId: string, scope: 'tool' | 'session', tool: string): void {
    const all = this.permAllow();
    const cur = all[sessionId] ?? {};
    if (scope === 'session') cur.all = true;
    else cur.tools = [...new Set([...(cur.tools ?? []), tool])];
    all[sessionId] = cur;
    this.store.setKv('permAllow', all);
    log.info(`permission: ${scope === 'session' ? 'everything' : tool} allowed for good in ${this.sessions.get(sessionId)?.title ?? sessionId}`);
  }

  /* ---------- scope ---------- */

  /** Every other session of the caller's project (a session outside any project sees none). */
  private inScope(caller: StoredSession, target: StoredSession): boolean {
    if (target.id === caller.id) return false;
    return caller.projectId !== '' && target.projectId === caller.projectId;
  }

  private target(caller: StoredSession, args: Json): StoredSession {
    const id = str(args['session_id']).trim();
    // a full id, or a unique prefix (messages print the first 8 characters)
    let t = id ? this.sessions.get(id) : undefined;
    if (!t && id.length >= 6) {
      const hits = this.all().filter((x) => x.id.startsWith(id));
      if (hits.length === 1) t = hits[0];
    }
    if (!t) throw new ToolError(`No session with id "${id}". Use list_sessions.`);
    if (!this.inScope(caller, t)) {
      throw new ToolError(`Session "${t.title}" is in another project: sessions can only ask sessions of their own project.`);
    }
    return t;
  }

  private describe(s: StoredSession, projects: Project[]): Json {
    return {
      session_id: s.id,
      title: s.title,
      agent: s.agent,
      project: s.projectId ? projectName(s.projectId, projects) : '(none)',
      project_id: s.projectId || null,
      status: s.status,
      running: this.sessions.isLive(s.id),
      cwd: s.cwd,
      updated: new Date(s.updatedAt).toISOString()
    };
  }

  /* ---------- delivery ---------- */

  private label(from: string): string {
    if (from === 'user') return USER;
    const s = this.sessions.get(from);
    return s ? `"${s.title}" (session ${s.id})` : 'a removed session';
  }

  /** Team traffic record; `from` is a session or the user ('user'). */
  private record(target: StoredSession, kind: 'directive' | 'report', from: { id: string; title: string }, message: string, read = true, task?: string): string {
    const text = `${from.title} → ${target.title}: ${clip(message.trim(), LOG_TEXT_MAX)}`;
    const item = this.store.addInbox(target.id, kind, text, read, from.id, Date.now(), task);
    this.apActive.set(target.projectId, Date.now());
    this.onInbox();
    return item.id;
  }

  /** A prompt printed since the last keystroke is still unanswered (the log keeps old prompts after redraws). */
  /** The usage-limit notice on the screen: when it resets (Claude Code waits for that, then goes on by itself). */
  private limited(t: StoredSession): string | undefined {
    const screen = plainTerminal(this.sessions.outputSinceInput(t.id)).slice(-1500);
    return LIMIT_RE.test(screen) ? (limitResetText(screen) ?? 'later') : undefined;
  }

  private needsAttention(t: StoredSession): boolean {
    return PROMPT_RE.test(plainTerminal(this.sessions.outputSinceInput(t.id)).slice(-1500));
  }

  /**
   * What is typed into a session: its queued messages. Several are numbered with their times (one block of text with
   * the messages run together is easy to misread as one request), and a session that was stopped for a while is told
   * so — it remembers the repository as it was, and branches and files may have changed since.
   */
  private withWakeNote(id: string, queue: Queued[]): string {
    const since = this.stoppedSince.get(id);
    this.stoppedSince.delete(id);
    const parts: string[] = [];
    const away = since ? Date.now() - since : 0;
    if (away >= STOPPED_NOTE_MS) {
      const h = Math.floor(away / 3_600_000);
      const m = Math.round((away % 3_600_000) / 60_000);
      parts.push(
        `[AgentO] You were stopped for ${h ? `${h} h ` : ''}${m} min and are running again. The repository, branches and files may have changed meanwhile: check the current state (git status, git branch, the files in question) before you rely on what you remember.`
      );
    }
    if (queue.length === 1) parts.push(queue[0]!.text);
    else {
      const clock = (at?: number): string => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
      parts.push(`[AgentO] ${queue.length} messages arrived, oldest first. Handle them in this order; each is separate.`);
      queue.forEach((q, i) => parts.push(`--- message ${i + 1} of ${queue.length}${q.at ? ` (${clock(q.at)})` : ''} ---\n${q.text}`));
    }
    return parts.join('\n\n');
  }

  private enqueue(targetId: string, item: Queued): void {
    const q = this.outbox.get(targetId) ?? [];
    q.push({ ...item, at: Date.now() });
    this.outbox.set(targetId, q);
    this.flush();
  }

  /** Deliver queued messages to idle targets; wake stopped ones; flag ones sitting on a prompt. */
  private flush(): void {
    for (const [id, all] of this.outbox) {
      // FYI riders nobody needed in time are dropped — never delivered on their own
      const now = Date.now();
      const queue = all.filter((q) => !(q.expires !== undefined && q.expires < now));
      if (queue.length !== all.length) this.outbox.set(id, queue);
      const t = this.sessions.get(id);
      if (!t || queue.length === 0) {
        this.outbox.delete(id);
        continue;
      }
      // a closed project keeps its queued messages until it is opened again
      if (this.isClosed(t.projectId)) continue;
      // only riders (a delegation note, a progress report): wait for something worth a turn — but not forever
      if (queue.every((q) => q.ride) && (queue.some((q) => q.expires !== undefined) || Date.now() - Math.min(...queue.map((q) => q.at ?? 0)) < RIDE_MAX_MS)) continue;
      if (!this.sessions.isLive(id)) {
        if (queue.every((q) => q.wake === false)) continue; // only notes: they ride along with its next work
        if (!this.resuming.has(id) && t.status !== 'starting') {
          // a session that keeps dying right after it starts is not woken again and again (an error storm): tell the
          // manager once and leave its messages queued until it is started by hand
          const recent = (this.wakes.get(id) ?? []).filter((at) => Date.now() - at < WAKE_WINDOW_MS);
          if (recent.length >= WAKE_MAX) {
            if (!this.wakeStopped.has(id)) {
              this.wakeStopped.add(id);
              this.store.addInbox(id, 'error', `${t.title} — stopped waking it: it failed to start ${recent.length} times in ${Math.round(WAKE_WINDOW_MS / 60_000)} min; ${queue.length} message(s) wait. Start it from its card.`);
              this.onInbox();
            }
            continue;
          }
          this.wakes.set(id, [...recent, Date.now()]);
          if (t.status === 'hibernated') this.stoppedSince.set(id, t.updatedAt);
          this.resuming.add(id);
          try {
            this.sessions.resume(id);
          } catch (e) {
            log.warn('team: could not wake session for queued messages', id, e);
          }
        }
        continue;
      }
      this.resuming.delete(id);
      if (t.status !== 'waiting') continue;
      if ((this.notBefore.get(id) ?? 0) > Date.now()) continue;
      // the previous directive was just typed in and has not been picked up yet
      const p = this.pending.get(id);
      if (p && !p.started && Date.now() - p.at < PICKUP_GRACE_MS) continue;
      // paused by the usage limit: the messages wait; Claude Code goes on by itself when the limit resets
      const reset = this.limited(t);
      if (reset || this.needsAttention(t)) {
        if (!this.attention.has(id)) {
          this.attention.add(id);
          this.store.addInbox(
            id,
            'waiting',
            reset
              ? `${t.title} — paused by Claude's usage limit (resets ${reset}); ${queue.length} team message(s) wait until it continues`
              : `${t.title} — answer its prompt so it can receive ${queue.length} team message(s)`
          );
          this.onInbox();
        }
        continue;
      }
      this.attention.delete(id);
      this.outbox.delete(id);
      const text = this.withWakeNote(id, queue);
      // what this delivery means for the pending work — set before typing: a headless session turns "working" the
      // moment the message is sent, and that transition must find the pending entry (else it never completes)
      const before = this.pending.get(id);
      const directive = [...queue].reverse().find((q) => q.from !== undefined);
      if (directive?.from) this.trackDirective(id, directive.from, directive.task);
      const pend = this.pending.get(id);
      if (pend && directive?.from) pend.text = text;
      try {
        this.sessions.paste(id, text);
        // it still shows "waiting" for a moment: messages queued right after go together in the next paste
        this.notBefore.set(id, Math.max(this.notBefore.get(id) ?? 0, Date.now() + 3000));
        this.onDelivered(id, text);
      } catch (e) {
        log.warn('team: delivery failed', id, e);
        this.outbox.set(id, queue);
        if (before) this.pending.set(id, before);
        else this.pending.delete(id);
        continue;
      }
    }
  }

  private trackDirective(targetId: string, from: string, task?: string): void {
    const prev = this.pending.get(targetId);
    if (prev?.timer) clearTimeout(prev.timer);
    // a sender still waiting keeps waiting: the result goes to everyone who asked
    const also = prev ? [...new Set([...(prev.also ?? []), prev.from])].filter((x) => x !== from) : [];
    // already running (a first prompt sent at creation): the work has started
    const st = this.sessions.get(targetId)?.status;
    this.pending.set(targetId, { from, ...(also.length ? { also } : {}), at: Date.now(), started: st === 'working' || st === 'starting', timer: null, ...(task ? { task } : {}) });
    this.director.set(targetId, from);
    this.answered(targetId);
    if (task && (st === 'working' || st === 'starting')) this.taskState(targetId, task, 'working');
  }

  /* ---------- autopilot ---------- */

  /** Switch a project's autopilot on or off (the lead session is told the rules when it goes on). */
  setAutopilot(projectId: string, on: boolean, leadId?: string): void {
    const root = this.project(projectId);
    if (!root) throw new Error('Project not found');
    // one session carries the project on: it does the work itself
    const lead = leadId ? this.sessions.get(leadId) : undefined;
    if (lead && lead.projectId !== root.id) throw new Error('That session is not in this project');
    if (on) {
      if (!lead) throw new Error('Pick the session that carries the project on');
      if (lead.agent !== 'claude') throw new Error('Autopilot needs a Claude session');
      if (this.isClosed(root.id)) throw new Error('Open the project first');
      const now = Date.now();
      this.store.setAutopilot(root.id, { on: true, since: now, continues: 0, lastAt: now, note: 'Switched on', leadId: lead.id });
      this.apRun.set(root.id, { at: 0, idle: 0, window: [] });
      this.apActive.set(root.id, now);
      this.enqueue(lead.id, { text: `${AUTOPILOT_RULES_SOLO}\nAutopilot is on now. First, in this answer: write down what "finished" means for this project and what is still open — read the plan documents and the memory, then record it with \`update_memory\` in the section Open (one line per open piece, "Done when: …" as the first line). Then start on it. If nothing is open, answer only AUTOPILOT DONE — do not report finished work again.`, wake: true });
    } else {
      const cur = root.autopilot;
      this.store.setAutopilot(root.id, cur ? { ...cur, on: false, lastAt: Date.now(), note: 'Switched off' } : null);
    }
    this.onProjects();
  }

  private autopilotStop(root: Project, lead: StoredSession, note: string): void {
    const cur = root.autopilot;
    this.store.setAutopilot(root.id, cur ? { ...cur, on: false, lastAt: Date.now(), note } : null);
    this.store.addInbox(lead.id, 'waiting', `${root.name} — Autopilot off: ${note}`);
    this.onInbox();
    this.onProjects();
    log.info('team: autopilot off', root.name, note);
  }

  /** The lead session resting with autopilot on is looked at after a short settle (a new turn cancels it). */
  private autopilotWatch(s: Session): void {
    // only the one session the project's autopilot was switched on for
    if (this.project(s.projectId)?.autopilot?.leadId !== s.id) return;
    const prev = this.apTimers.get(s.id);
    if (s.status !== 'waiting') {
      if (prev) {
        clearTimeout(prev);
        this.apTimers.delete(s.id);
      }
      return;
    }
    if (!this.project(s.projectId)?.autopilot?.on) return;
    if (prev) clearTimeout(prev);
    this.apTimers.set(
      s.id,
      setTimeout(() => {
        this.apTimers.delete(s.id);
        this.autopilotCheck(s.id);
      }, AUTOPILOT_SETTLE_MS)
    );
  }

  private autopilotSweep(): void {
    for (const s of this.all()) if (s.status === 'waiting' && !this.apTimers.has(s.id)) this.autopilotWatch(s);
  }

  private autopilotCheck(leadId: string): void {
    const lead = this.sessions.get(leadId);
    const root = lead ? this.project(lead.projectId) : undefined;
    const ap = root?.autopilot;
    if (!lead || !root || !ap?.on || lead.status !== 'waiting') return;
    // closed, paused by the usage limit, or stuck on a prompt: not a pause to act on
    if (this.isClosed(root.id) || this.limited(lead) || this.needsAttention(lead)) return;
    // something is on its way to it: wait for that
    if ((this.outbox.get(lead.id) ?? []).length > 0) return;
    if (/AUTOPILOT\s+DONE/i.test(this.lastReply(lead, 3000))) {
      this.autopilotStop(root, lead, 'finished — the session reported AUTOPILOT DONE');
      return;
    }
    const now = Date.now();
    const run = this.apRun.get(root.id) ?? { at: 0, idle: 0, window: [] };
    run.window = run.window.filter((t) => now - t < 3_600_000);
    if (run.window.length >= AUTOPILOT_MAX_PER_HOUR) {
      this.autopilotStop(root, lead, `paused — ${AUTOPILOT_MAX_PER_HOUR} continues in an hour (switch it on again to go on)`);
      return;
    }
    // told to carry on last time, and nothing was handed out or reported since: no progress
    if (run.at && (this.apActive.get(root.id) ?? 0) <= run.at) run.idle++;
    else run.idle = 0;
    if (run.idle >= AUTOPILOT_MAX_IDLE) {
      this.autopilotStop(root, lead, `stopped — no progress after ${AUTOPILOT_MAX_IDLE} continues`);
      return;
    }
    run.at = now;
    run.window.push(now);
    this.apRun.set(root.id, run);
    const n = ap.continues + 1;
    this.store.setAutopilot(root.id, { ...ap, continues: n, lastAt: now, note: `Continue #${n}` });
    this.onProjects();
    this.enqueue(lead.id, {
      text: `${AUTOPILOT_RULES_SOLO}\nNothing is running now. Take the next open piece from the memory section Open and do it yourself (remove a line from Open with \`update_memory\` when its piece is finished and checked); if Open is empty, answer only AUTOPILOT DONE (no report of finished work).`,
      wake: true
    });
    log.info('team: autopilot continue', root.name, n);
  }

  private onStatus(s: Session): void {
    this.autopilotWatch(s);
    // it runs again (started by hand, or a wake that took): the crash-loop guard lets go
    if (s.status === 'waiting' && this.wakeStopped.delete(s.id)) this.wakes.delete(s.id);
    // a (re)started CLI draws its UI first; give it a moment before typing into it
    if (s.status === 'starting') this.notBefore.set(s.id, Math.max(this.notBefore.get(s.id) ?? 0, Date.now() + START_SETTLE_MS));
    const p = this.pending.get(s.id);
    if (s.status === 'waiting') setTimeout(() => this.flush(), 200);
    if (!p) return;
    if (s.status === 'working' || s.status === 'starting') {
      if (!p.started) this.taskState(s.id, p.task, 'working');
      p.started = true;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      return;
    }
    if (!p.started) return;
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      const cur = this.sessions.get(s.id);
      if (cur && cur.status !== 'working' && cur.status !== 'starting' && this.pending.get(s.id) === p) this.complete(cur, p);
    }, s.status === 'waiting' ? SETTLE_MS : 0);
  }

  /** The directed session finished: report its last reply to whoever sent the directive. */
  private complete(s: StoredSession, p: Pending): void {
    // idle on a question (permission / confirmation prompt), or paused by the usage limit: not finished — tell the
    // manager once, keep waiting for the end
    const reset = s.status === 'waiting' ? this.limited(s) : undefined;
    if (s.status === 'waiting' && (reset || this.needsAttention(s))) {
      if (!p.blocked) {
        p.blocked = true;
        p.started = false;
        const who = p.from === 'user' ? 'your order' : `a task from "${this.sessions.get(p.from)?.title ?? 'a session'}"`;
        this.store.addInbox(
          s.id,
          'waiting',
          reset
            ? `${s.title} — paused by Claude's usage limit (resets ${reset}) while working on ${who}; it continues by itself`
            : `${s.title} — stuck on a prompt while working on ${who}: answer it in its Terminal`
        );
        this.taskState(s.id, p.task, 'blocked', reset ? `usage limit, resets ${reset}` : 'stuck on a prompt in its terminal');
        this.onInbox();
      }
      return;
    }
    // the message never reached the conversation (typed into a dialog, or not submitted): the last reply is an old
    // one — do not report it again as the answer; tell the manager once and keep waiting
    const taken = this.lastTakenAt(s);
    if (taken !== undefined && taken < p.at - 2000) {
      // once: type it again (the session was restarting, or a dialog swallowed it) — the work stays the same task
      if (!p.resent && p.text && s.status === 'waiting') {
        p.resent = true;
        p.started = false;
        p.at = Date.now();
        log.info('team: the message was not taken, resending once', s.id, p.task ?? '');
        this.enqueue(s.id, { text: p.text });
        return;
      }
      if (!p.blocked) {
        p.blocked = true;
        p.started = false;
        this.store.addInbox(s.id, 'waiting', `${s.title} — did not take the message (a dialog or prompt in its Terminal?): open it, close the dialog, and send again`);
        this.taskState(s.id, p.task, 'blocked', 'the session did not take the message');
        this.onInbox();
      }
      return;
    }
    this.pending.delete(s.id);
    for (const other of p.also ?? []) this.complete(s, { from: other, at: p.at, started: true, timer: null });
    const reply = this.lastReply(s, 1500);
    // a turn that ended right after passing the work on "replied" (the result comes later); otherwise it is the work itself
    const state = s.status !== 'waiting' ? `stopped (${s.status})` : p.delegated ? 'replied' : 'finished';
    if (s.status !== 'waiting') this.taskState(s.id, p.task, 'blocked', `the session stopped (${s.status})`);
    else {
      this.taskState(s.id, p.task, state === 'replied' ? 'handed' : 'reported');
      // what the manager typed into it during this turn was part of the same turn
      for (const r of this.ledger.openOf(s.id)) if (r.from === 'user' && r.state === 'working' && r.id !== p.task) this.taskState(s.id, r.id, 'reported');
    }
    if (p.from === 'user') {
      // a session that just handed the work on has no result yet: recorded as "handed on" (shown faintly, no alert)
      const shown = state === 'replied' ? 'handed on' : state;
      this.store.addInbox(s.id, 'report', `${s.title} ${shown}: ${clip(reply.trim(), LOG_TEXT_MAX) || '(no reply text)'}`, false, s.id, Date.now(), p.task);
      this.onInbox();
      return;
    }
    const sender = this.sessions.get(p.from);
    if (!sender) return;
    this.enqueue(sender.id, {
      text: `[AgentO] "${s.title}" (session ${s.id.slice(0, 8)}) ${state} the task you sent${p.task ? ` (${p.task})` : ''}. Its last reply:\n${reply || '(no reply text)'}`,
      report: true,
      // a session whose turn ended after handing the work on: its real result comes later —
      // this note rides along with that instead of costing the sender a turn now
      ...(state === 'replied' ? { ride: true } : {})
    });
    this.record(sender, 'report', s, `${state}: ${reply}`, true, p.task);
  }

  /** Last assistant turn (Claude transcript) or the end of the terminal. */
  private lastReply(s: StoredSession, max: number): string {
    const entries = this.chat(s);
    if (entries) {
      const lastUser = entries.map((e) => e.kind).lastIndexOf('user');
      // the end of the turn: its last words are the result (the start is narration like "Let me look at…")
      const said = entries.slice(lastUser + 1).filter((e) => e.kind === 'assistant' && (e.text ?? '').trim());
      const text = (said[said.length - 1]?.text ?? '').trim();
      if (text) return text.length > max ? `(…${text.length - max} chars before) ${text.slice(-max)}` : text;
    }
    return plainTerminal(this.sessions.scrollback(s.id)).slice(-Math.min(max, 1000)).trim();
  }

  private chat(s: StoredSession): ChatEntry[] | undefined {
    if (s.agent === 'codex' && s.resumeId) {
      const file = findCodexRollout(s.resumeId);
      return file ? readCodex(file).entries : undefined;
    }
    if (s.agent !== 'claude' || !s.resumeId) return undefined;
    const file = findTranscript(s.cwd, s.resumeId);
    if (!file) return undefined;
    const parser = new TranscriptParser();
    for (const line of readTranscriptLines(file)) {
      try {
        parser.feed(JSON.parse(line) as Json);
      } catch {
        /* partial line */
      }
    }
    return parser.entries;
  }

  private checkRate(caller: StoredSession): void {
    const now = Date.now();
    const list = (this.sent.get(caller.id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (list.length >= RATE_LIMIT) {
      throw new ToolError(
        `You sent ${list.length} messages in the last 10 minutes, the limit. ` +
          'Stop messaging; continue your own work or report_up.'
      );
    }
    list.push(now);
    this.sent.set(caller.id, list);
  }

  /** Session → session message; a directive's completion is reported back to the sender. */
  private send(caller: StoredSession, t: StoredSession, message: string, directive: boolean, ride = false): string {
    if (!message.trim()) throw new ToolError('message is empty');
    this.checkRate(caller);
    const task = directive ? this.newTask(t) : this.taskOf(caller.id);
    const text = `[Message from ${this.label(caller.id)}${task ? ` — ${task}` : ''}]\n${message.trim()}`;
    if (directive && task) {
      this.openTask(task, caller.id, t, message);
      this.answered(t.id);
    }
    if (directive) {
      const p = this.pending.get(caller.id);
      if (p) p.delegated = true;
    }
    this.enqueue(t.id, directive ? { text, from: caller.id, task } : ride ? { text, ride: true, report: true } : { text, report: true });
    this.record(t, directive ? 'directive' : 'report', caller, message, true, task);
    const queued = this.outbox.has(t.id);
    return (
      `${queued ? 'Queued for' : 'Delivered to'} "${t.title}"${queued ? ' (it is busy or stopped; delivered when it is idle)' : ''}.` +
      (directive ? ' You will get an "[AgentO] … finished" message when it is done.' : '')
    );
  }

  /* ---------- tools ---------- */

  private readonly tools: ToolDef[] = [
    {
      // Claude Code's permission prompt (headless sessions, --permission-prompt-tool): allow in a trusted folder, else ask the manager
      name: 'permission',
      description: 'Internal: Claude Code asks whether a tool may be used (headless sessions). Not for sessions to call.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
      run: async (caller, args) => {
        const tool = str(args['tool_name']);
        const input = (typeof args['input'] === 'object' && args['input'] !== null ? args['input'] : {}) as Record<string, unknown>;
        // the manager marked the folder as trusted (autoTrust): the session may do its work without asking
        const folder = this.store.listProjects().flatMap((p) => p.folders).find((f) => f.id === caller.folderId);
        const teamFolder = !caller.folderId && caller.cwd.toLowerCase().startsWith(this.teamDir().toLowerCase());
        if (folder?.autoTrust || teamFolder) return JSON.stringify({ behavior: 'allow', updatedInput: input });
        // the manager said "always" for this tool, or for everything, in this session
        const kept = this.permAllow()[caller.id];
        if (kept?.all || kept?.tools?.includes(tool)) return JSON.stringify({ behavior: 'allow', updatedInput: input });
        const r = await this.sessions.requestPermission(caller.id, tool, input);
        return JSON.stringify(r);
      }
    },
    {
      name: 'update_memory',
      description: MEMORY_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          section: { type: 'string', enum: [...MEMORY_SECTIONS] },
          text: { type: 'string', description: 'the line(s) to add / the new section (replace) / the text the lines to drop contain (remove)' },
          mode: { type: 'string', enum: ['append', 'replace', 'remove'], description: MEMORY_MODES_HELP },
          project_id: { type: 'string', description: 'only for a session outside any project: which project' }
        },
        required: ['section', 'text']
      },
      run: (caller, args) => {
        const root = caller.projectId ? this.project(caller.projectId) : this.project(str(args['project_id']));
        if (!root) throw new ToolError(caller.projectId ? 'Your project was not found' : 'Say which project (project_id)');
        const section = str(args['section']) as MemorySection;
        if (!(MEMORY_SECTIONS as readonly string[]).includes(section)) throw new ToolError(`section must be one of ${MEMORY_SECTIONS.join(', ')}`);
        const mode = (str(args['mode']) || 'append') as MemoryMode;
        if (!['append', 'replace', 'remove'].includes(mode)) throw new ToolError('mode must be append, replace or remove');
        const r = updateMemory(root.id, root.name, section, str(args['text']), mode);
        if ('error' in r) throw new ToolError(r.error);
        log.info(`memory ${root.name} ${section} ${mode} by ${caller.title}`);
        return `${section}: ${r.lines} line${r.lines === 1 ? '' : 's'} (memory ${r.total}/60). New sessions of "${root.name}" get it at start; running ones on their next start or fresh start.`;
      }
    },
    {
      name: 'list_sessions',
      description:
        'List the other sessions of your project with ' +
        'status (starting, working, waiting = idle or needs input, done, error, hibernated).',
      inputSchema: { type: 'object', properties: { project_id: { type: 'string', description: 'Only this project (optional)' } } },
      run: (caller, args) => {
        const projects = this.store.listProjects();
        const pid = str(args['project_id']);
        const list = this.all()
          .filter((s) => this.inScope(caller, s) && (!pid || s.projectId === pid))
          .map((s) => this.describe(s, projects));
        return list.length ? JSON.stringify(list, null, 2) : 'No sessions in scope.';
      }
    },
    {
      name: 'read_session',
      description: "Read a session's recent conversation (Claude sessions) or terminal output (others).",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          max_entries: { type: 'number', description: 'Conversation entries to return (default 10; keep it small — it all stays in your context)' },
          source: { type: 'string', enum: ['auto', 'chat', 'terminal'], description: 'Default auto' }
        },
        required: ['session_id']
      },
      run: (caller, args) => {
        const t = this.target(caller, args);
        const source = str(args['source']) || 'auto';
        const max = Math.max(1, Math.min(200, Math.floor(num(args['max_entries'], 10))));
        const head = `"${t.title}" — status ${t.status}${this.sessions.isLive(t.id) ? '' : ' (not running)'}`;
        if (source !== 'terminal') {
          const entries = this.chat(t);
          if (entries) {
            const lines = entries.map(chatLine).filter((l): l is string => l !== null);
            const shown = lines.slice(-max);
            const skipped = lines.length - shown.length;
            return `${head}\n${skipped > 0 ? `(${skipped} earlier entries omitted)\n` : ''}\n${shown.join('\n\n') || '(no messages yet)'}`;
          }
          if (source === 'chat') return `${head}\n(no conversation yet)`;
        }
        const text = plainTerminal(this.sessions.scrollback(t.id)).slice(-6000);
        return `${head}\n\n--- terminal (last ${text.length} chars) ---\n${text || '(no output)'}`;
      }
    },
    {
      name: 'send_to_session',
      description:
        'Send a message to a session in your scope. It is typed in as one message when the session is idle (queued ' +
        'while it works, woken if stopped). Set directive=false for a plain answer or remark; a directive (default) ' +
        'reports back to you automatically when the session finishes it.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          message: { type: 'string', description: 'Self-contained instruction, question or answer' },
          directive: { type: 'boolean', description: 'Report back when done (default true)' }
        },
        required: ['session_id', 'message']
      },
      run: (caller, args) => {
        const t = this.target(caller, args);
        return this.send(caller, t, str(args['message']), args['directive'] !== false);
      }
    },
    {
      name: 'report_up',
      description:
        'Report progress or ask a question to whoever gave you your latest order or directive (the manager — the ' +
        'user — or a session). Without one, it goes to the manager.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          needs_answer: { type: 'boolean', description: 'true when you cannot go on without an answer to a question in this message' }
        },
        required: ['message']
      },
      run: (caller, args) => {
        const message = str(args['message']).trim();
        if (!message) throw new ToolError('message is empty');
        if (args['needs_answer'] === true) this.taskState(caller.id, this.taskOf(caller.id), 'asking', message.split('\n').find((l) => l.trim())?.slice(0, 200));
        const d = this.director.get(caller.id);
        const up = d === 'user' ? undefined : d ? this.sessions.get(d) : undefined;
        if (!up || up.id === caller.id) {
          this.checkRate(caller);
          // it reported explicitly: no automatic copy of its last reply when the turn ends
          if (this.pending.get(caller.id)?.from === 'user') this.pending.delete(caller.id);
          this.store.addInbox(caller.id, 'report', `${caller.title} → Manager (you): ${clip(message, LOG_TEXT_MAX)}`, false, caller.id, Date.now(), this.taskOf(caller.id));
          this.onInbox();
          return 'Sent to the manager (the user). Their answer, if any, arrives as an "[Order from …]" message.';
        }
        // still working on a task from them: the report goes along with the "finished" message, not as a turn of its own
        const riding = this.pending.get(caller.id)?.from === up.id;
        return this.send(caller, up, `(report) ${message}`, false, riding);
      }
    },
  ];

  private instructions(_s: StoredSession): string {
    return PLAYER_INSTRUCTIONS;
  }

  /* ---------- MCP over HTTP ---------- */

  /** Returns false when the request is not for us. */
  handleHttp(req: IncomingMessage, res: ServerResponse): boolean {
    // /mcp/<sessionId>, or /mcp with an X-AgentO-Session header
    const m = /^\/mcp(?:\/([0-9a-f-]{36}))?\/?$/.exec((req.url ?? '').split('?')[0] ?? '');
    if (!m) return false;
    if (req.headers['authorization'] !== `Bearer ${this.conn.token}`) {
      res.writeHead(401).end();
      return true;
    }
    const caller = this.sessions.get(m[1] ?? str(req.headers['x-agento-session']));
    if (!caller) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Unknown session.');
      return true;
    }
    if (req.method !== 'POST') {
      // No server-initiated stream; DELETE (session end) is a no-op.
      res.writeHead(req.method === 'DELETE' ? 200 : 405, { Allow: 'POST' }).end();
      return true;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
        return;
      }
      const batch = Array.isArray(body) ? body : [body];
      void Promise.all(batch.map((x) => this.rpc(caller.id, x))).then((out) => {
        const replies = out.filter((r): r is Json => r !== null);
        if (replies.length === 0) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
      });
    });
    return true;
  }

  private async rpc(callerId: string, m: unknown): Promise<Json | null> {
    if (typeof m !== 'object' || m === null) return rpcError(null, -32600, 'Invalid request');
    const msg = m as Json;
    const id = msg['id'] as string | number | undefined;
    const method = str(msg['method']);
    if (id === undefined || id === null) return null; // notification / response
    const caller = this.sessions.get(callerId);
    if (!caller) return rpcError(id, -32001, 'Caller session is gone');
    const params = (typeof msg['params'] === 'object' && msg['params'] !== null ? msg['params'] : {}) as Json;
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: str(params['protocolVersion']) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: this.conn.version },
          instructions: this.instructions(caller)
        });
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, {
          tools: this.tools
            .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === str(params['name']));
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${str(params['name'])}`);
        const args = (typeof params['arguments'] === 'object' && params['arguments'] !== null ? params['arguments'] : {}) as Json;
        try {
          const text = await tool.run(caller, args);
          return rpcResult(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!(e instanceof ToolError)) log.warn(`team tool ${tool.name} failed`, e);
          return rpcResult(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

function rpcResult(id: string | number, result: unknown): Json {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string): Json {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

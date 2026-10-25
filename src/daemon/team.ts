/**
 * Team layer, modelled on a football club. The user is the manager and gives orders; the sessions collaborate:
 * - head coach: optional, one per daemon; splits cross-project orders among the coaches and reports to the user.
 * - coach: optional, one per project; manages and questions that project's players. A player can be promoted to
 *   "playing coach" (keeps coding in its project folder, gains the coach tools).
 * - player: an ordinary session inside a project; does the actual work. All coding goes to Claude.
 *
 * Team sessions reach this daemon's MCP endpoint (POST http://127.0.0.1:<port>/mcp/<sessionId>, Streamable HTTP with
 * JSON responses). Every role sees the same tool list; permissions are checked per call against the caller's current
 * role, so a role change applies without a restart.
 *
 * Messages between sessions go through an outbox: delivered as one bracketed paste when the target is idle, held while
 * it works or sits on a permission/trust prompt. When a directed session finishes, whoever sent the directive gets an
 * automatic report with its last reply (the user's orders are reported to the inbox).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentKind, ChatEntry, Project, Session, SessionRole, TeamOrderTarget } from '@shared/protocol';
import type { Store, StoredSession } from './store';
import type { SessionManager } from './sessions';
import { attachmentsDir, dataDir, ensureDir } from './paths';
import { TranscriptParser, findTranscript, readTranscriptLines } from './transcript';
import { log } from './log';
import { arrangeTeam } from '@shared/layout';
import { plainTerminalLines } from '@shared/plaintext';
import { LIMIT_RE, PROMPT_RE, limitResetText } from '@shared/prompts';
import { findCodexRollout, readCodex } from './codex';
import { MEMORY_MODES_HELP, MEMORY_SECTIONS, MEMORY_TOOL_DESCRIPTION, ensureMemory, memorySystemPrompt, updateMemory, type MemoryMode, type MemorySection } from './memory';
import { AUTO_MIN_GAP_MS, AUTO_FRESH, AUTO_IDLE_MS, AUTO_MIN_CONTEXT, AUTO_MIN_CONTEXT_COORD, HANDOFF_CONTINUE, HANDOFF_REQUEST, conversationStart, handoffDir, handoffPath, AUTO_OVERSIZE_FACTOR, AUTO_OVERSIZE_IDLE_MS, AUTO_MANAGER_QUIET_MS, HANDOFF_MARK } from './freshstart';

export const MCP_SERVER_NAME = 'agento';
const MAX_BODY = 1024 * 1024;
const MAX_WAIT_S = 600;
/** Team traffic is recorded in full (the Log tab shows it) up to this length. */
const LOG_TEXT_MAX = 4000;

/**
 * Token economy for the coordinators (head coaches, coaches — Claude): they split orders and review reports, so
 * - a lighter model and effort (env AGENTO_COACH_MODEL, default "sonnet"; AGENTO_COACH_EFFORT, default "medium";
 *   empty = the CLI's default),
 * - no editing tools (Edit/Write/MultiEdit/NotebookEdit): the work and its output belong in players' contexts,
 * - auto-compact at AGENTO_COACH_COMPACT_PCT % of the context window (default 60; empty = the CLI's default).
 * Players keep the CLI defaults. Applies at the next start/resume of a session.
 */
const envOr = (k: string, d: string): string => (process.env[k] !== undefined ? process.env[k]!.trim() : d);
const COORDINATOR_MODEL = envOr('AGENTO_COACH_MODEL', 'sonnet');
const COORDINATOR_EFFORT = envOr('AGENTO_COACH_EFFORT', 'medium');
const COORDINATOR_COMPACT_PCT = envOr('AGENTO_COACH_COMPACT_PCT', '60');
const COORDINATOR_ARGS = (pick?: string): string[] => [
  ...(pick || COORDINATOR_MODEL ? ['--model', pick || COORDINATOR_MODEL] : []),
  ...(COORDINATOR_EFFORT ? ['--effort', COORDINATOR_EFFORT] : []),
  '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'
];

/** How a coordinator keeps its context (and so every later call) small — in the head coach and coach instructions. */
const LEAN_CONTEXT = `## Keep your context small

Everything you read stays in your conversation and is read again on every later call, so:
- Do not build, test, or run long commands yourself — have a player do it and report the result. If you must run one,
  keep its output short (\`| tail -n 40\`, \`--quiet\`).
- Do not read whole large files, images or PDFs; ask a player for a summary or read only the lines you need.
- \`read_session\` with a small \`max_entries\` (5–10) is usually enough; the "[AgentO] … finished" message already
  carries the last reply.
- Editing tools are switched off for you: players change files.`;
/** Per-call tool timeout given to the CLIs: longer than the longest wait_for_sessions. */
const TOOL_TIMEOUT_S = MAX_WAIT_S + 60;
/** Codex reads the bearer token for the MCP endpoint from this env var (set per launch). */
const TOKEN_ENV = 'AGENTO_MCP_TOKEN';
/** A directive counts as "not picked up yet" for this long if the session never starts working. */
const PICKUP_GRACE_MS = 20_000;
/** No delivery for this long after a session starts, or after its folder-trust prompt was answered. */
const START_SETTLE_MS = 5_000;
const TRUST_SETTLE_MS = 8_000;
/** Waiting must hold this long before a directed session counts as finished (status flips on output pauses). */
const SETTLE_MS = 4_000;
/** a rider (a note that only goes along with another message) is delivered on its own after this long */
const RIDE_MAX_MS = 15 * 60_000;
/** how long reports to a coordinator are held so several arrive in one turn */
const REPORT_BATCH_MS = 20_000;
/** Messages a session may send per window — stops two sessions from bouncing messages forever. */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT: Record<SessionRole, number> = { head: 60, coach: 60, player: 12 };

/** Agents a coach can run on. The head coach and players are always Claude. */
export const COACH_AGENTS = ['claude', 'codex', 'gemini'] as const;
export type CoachAgent = (typeof COACH_AGENTS)[number];

/** Instruction file each CLI reads from its working directory. */
const INSTRUCTION_FILES: Record<CoachAgent, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' };
/** First line of generated instruction files; while it is there the file is regenerated, delete it to keep edits. */
const GENERATED_MARK = '<!-- agento:generated — delete this line to keep your own edits -->';

const ROLE_NAME: Record<SessionRole, string> = { head: 'head coach', coach: 'coach', player: 'player' };
/** Shown as the sender of the user's orders. */
const USER = 'the manager (the user)';
/** sender of what the user types into a session directly (the renderer tells these from orders by it) */
const DIRECT = 'Manager (you) · Direct';

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
  /** roles allowed to call it (checked per call, the list itself is the same for everyone) */
  roles: SessionRole[];
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
}

interface Queued {
  text: string;
  /** set when this is a directive (its completion is reported back to the sender) */
  from?: string;
  /** false: a note that waits for the session's next work instead of waking it (e.g. "you are now the coach") */
  wake?: boolean;
  /** never delivered on its own, even to an idle session: it goes along with the next message that is (saves a turn) */
  ride?: boolean;
  /** when it was queued (a rider waits at most RIDE_MAX_MS) */
  at?: number;
  /** a report / answer (not a directive): to a head coach or coach it waits REPORT_BATCH_MS so close ones arrive together */
  report?: boolean;
}

class ToolError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const TEAM_INTRO = `This is an AgentO team, organised like a football club:
- the **manager** is the user — they give the orders and may run several projects at once;
- a **project** is one piece of work (e.g. a shop page); it is split into **parts** (e.g. planning, development, QA);
- each project has an optional **head coach** (its PM) that splits orders among the parts' coaches and reports to the user;
- each part has an optional **coach** that manages and questions the part's players (a player may be the "playing
  coach" of its part);
- **players** are the sessions inside a part and do the actual work. All coding is done by Claude players.

Messages from other sessions arrive as text starting with "[Message from …]", "[Order from …]" or "[AgentO] …".`;

/** "Shop › 개발" for a part, "Shop" for a project. */
function projectPath(id: string, projects: Project[]): string {
  const p = projects.find((x) => x.id === id);
  if (!p) return '(deleted project)';
  const parent = p.parentId ? projects.find((x) => x.id === p.parentId) : undefined;
  return parent ? `${parent.name} › ${p.name}` : p.name;
}

/** Optional CLI dialogs AgentO closes with Esc (they would swallow team messages as keystrokes). */
const OPTIONAL_DIALOGS = [/Teach\s*auto\s*mode\s*about\s*your\s*environment/i];

/** The cross-check reviewer every new project gets: a Codex session (a second model) beside the Claude players. */
export const REVIEWER_TITLE = 'Codex 검토';

function headMd(project: Project | undefined, projects: Project[]): string {
  const parts = project ? projects.filter((p) => p.parentId === project.id).map((p) => `- ${p.name} (id ${p.id})`).join('\n') : '';
  const scope = project
    ? `You are the **head coach** (PM) of the project "${project.name}" (id ${project.id}). Its parts:

${parts || '- (no parts yet)'}`
    : `You are the **head coach of the whole team** — the one head coach that belongs to no project. Orders the manager
gives without picking a project come to you:

- Decide which project the order is about (\`list_projects\`, \`list_sessions\`, and \`read_session\` on the project head
  coaches if needed) and \`send_to_session\` it to that project's head coach — or to several, each with its own part.
- If it fits no existing project, \`create_project\` (name, optional folders, brief): the new project gets its own
  head coach, which receives your brief as its first order.
- A project without a head coach: send to its coach or first player (\`list_sessions\` shows roles).
- You coordinate; you do not implement. When the projects report back, \`report_up\` the joined result to the manager.`;
  return `${GENERATED_MARK}
# Role: Head Coach${project ? ` — ${project.name}` : ''}

${TEAM_INTRO}

${scope}

## How to work

- Orders from the manager (the user) come to you: split them into tasks and hand each task straight to the player
  who does it (\`send_to_session\`). You manage the parts' players yourself — no coach in between (a coach that only
  passes your messages on costs tokens and time). A part that does have a coach: give it to the coach.
- Do not make coaches (\`make_coach\`) unless a part has 4 or more players that need constant review, or the
  manager asks for one.
- Every message that reaches you costs a turn that re-reads your whole conversation, so: give a player its related
  tasks in one message, not one by one; for a small task whose result you will not review, send it with
  \`directive=false\` and ask the player to \`report_up\` only if it is blocked — then no completion report wakes you.
- Do not do the implementation yourself.
- Instructions must be self-contained: goal, files/scope, constraints, and what "done" means.
- When a session finishes what you sent, you get an "[AgentO] … finished" message with its last reply — no need to poll.
  Its last reply is normally enough — \`read_session\` (max_entries 3) only when it is unclear. Decide the next step,
  and \`report_up\` to the manager when an order is done or blocked.
- To the manager, only what needs the manager: the result when an order is done, or a blocker / decision — one
  message, essentials only (what changed, where, what to decide). No progress notes and no restating of the order:
  the manager watches progress in AgentO. When your turn ends right after handing work on, answer in one line
  ("→ <session>: <task>"), not a summary.
- Questions you cannot answer yourself go to the manager with \`report_up\`.
- Project memory (\`update_memory\`): the short note every session of the project gets at start — keep it current.
  When a piece finishes or a decision is made, put what the others need there (Decisions · Conventions · Map ·
  Don't · Open), one line each; replace or remove lines that are outdated. It is what lets conversations start short.${project ? `
- Review: if your project has a Codex session titled "${REVIEWER_TITLE}" (\`list_sessions\`), it is the cross-check reviewer —
  a second model. Claude players do the work; before you report a finished piece to the manager, \`send_to_session\` the
  reviewer what to check (goal, changed files or commits, how to verify). It reviews only and does not edit files.
  Put its verdict in your report and send real problems back to the player. Never give it implementation work.` : ''}

${LEAN_CONTEXT}
`;
}

function coachMd(project: Project): string {
  const folders = project.folders.map((f) => `- ${f.path}`).join('\n') || '- (no folders yet)';
  return `${GENERATED_MARK}
# Role: Coach — ${project.name}

${TEAM_INTRO}

You are the **coach** of the project "${project.name}" (id ${project.id}).

## How to work

- Break the orders you receive into tasks and assign them to this project's players (\`send_to_session\`). Create a
  player (\`create_session\`) only when the work needs another pair of hands.
- Ask questions — to players about progress and blockers; to whoever gave you the order when priorities are unclear.
- Do not do the implementation yourself; Claude players do all the coding. You may read the project folders to review.
- When a player finishes what you sent, you get an "[AgentO] … finished" message with its last reply — no need to poll.
  Its last reply is normally enough (\`read_session\` only when unclear); assign the next task, and \`report_up\` when the
  order is done or blocked.
- Upward, only what is needed: the result when the order is done, or a blocker / decision — one message, essentials
  only. No progress notes. When your turn ends right after handing work on, answer in one line ("→ <session>: <task>").
- Project memory (\`update_memory\`): when a piece finishes or a decision is made, put what every session of the
  project needs there (Decisions · Conventions · Map · Don't · Open), one line each; drop outdated lines.
- Players may ask you questions; answer them with \`send_to_session\`.

${LEAN_CONTEXT}

## Project folders

${folders}

`;
}

const PLAYER_INSTRUCTIONS = `AgentO team tools. ${TEAM_INTRO}
You are a **player**: do the work you are given in your project folder. When you are blocked or unsure, ask whoever
gave you the work (your head coach, or your coach if your part has one) with report_up instead of stopping. When a
teammate's work affects yours, coordinate with them (list_sessions, read_session, send_to_session to a teammate). Do
not send a message just to acknowledge — whoever gave you the work is told automatically when you finish, so do not
\`report_up\` a finished task either: ending your answer is the report. \`report_up\` only when you are blocked or need
a decision.
When you learn something every teammate needs — a convention, where something is, a trap — add one line to the
project memory with \`update_memory\` (Conventions / Map / Don't); it is given to every session at start.
End a finished task with a short report. Its first line names the feature in a few words, as
"Feature: <what was added or changed>" (in the language you report in, e.g. "기능: 상품 상세 리뷰 정렬 추가") — the
manager's Timeline lists features by this line. Then: what you did, the files you changed (paths), how it was checked,
and what needs a decision — a few lines, not the whole story (it is read by someone managing several players).`;

const PLAYING_COACH_NOTE = (project: string): string =>
  `[AgentO] You are now the playing coach of the project "${project}". Keep doing your own work, and also manage this ` +
  `project's other players: assign tasks with send_to_session, create players with create_session, review their ` +
  `results (you get an "[AgentO] … finished" message when one finishes), and report_up to the manager when an order is ` +
  `done or blocked.`;

export class Team {
  /** sessions that were sent a directive, keyed by target */
  private pending = new Map<string, Pending>();
  /** stopped sessions the user just typed into (note() before message()): their queued message is tracked like an order */
  private directNext = new Set<string>();
  /** who received the latest order (a routine remembers them to skip a run while they are still on the last one) */
  lastRecipients: string[] = [];

  /** The queues as last saved: messages not delivered yet, who waits for whose result, who to report_up to. */
  private saved = '';
  private persist(): void {
    const state = {
      outbox: [...this.outbox],
      pending: [...this.pending].map(([id, p]) => [id, { from: p.from, also: p.also, at: p.at, blocked: p.blocked }]),
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
    type Saved = { outbox: [string, Queued[]][]; pending: [string, { from: string; also?: string[]; at: number; blocked?: boolean }][]; director: [string, string][] };
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

  /** Still on an order: a directive from the manager not yet finished, messages queued, or working. */
  stillOn(ids: string[]): boolean {
    return ids.some((id) => {
      const s = this.sessions.get(id);
      return this.pending.get(id)?.from === 'user' || this.hasMail(id) || s?.status === 'working' || s?.status === 'starting';
    });
  }
  /** fresh starts under way: the handoff note asked for, and when */
  private fresh = new Map<string, { file: string; at: number; why: 'manual' | 'auto'; timer: NodeJS.Timeout | null; started: boolean }>();
  /** messages waiting until their target is idle */
  private outbox = new Map<string, Queued[]>();
  /** targets the user was already told about (sitting on a prompt) */
  private attention = new Set<string>();
  /** targets we already tried to resume for queued messages */
  private resuming = new Set<string>();
  /** send timestamps per caller (rate limit) */
  private sent = new Map<string, number[]>();
  /** called after a team message was typed into a session (the UI replays it in the card's message box) */
  onDelivered: (sessionId: string, text: string) => void = () => {};
  /** called after the project / part tree changed (a head coach organizing its project) */
  onProjects: () => void = () => {};
  /** starts a project the way Orders › New project does (project, folders, head coach, brief) — wired by the daemon */
  startProject: (name: string, folders: string[], brief: string, plan: boolean) => Session = () => {
    throw new Error('startProject is not wired');
  };
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
    sessions.keepAwake = (id) => this.fresh.has(id);
    // every 2 minutes (an oversized conversation waits only a short pause; the others still need 25 idle minutes)
    if (AUTO_FRESH) setInterval(() => this.autoFresh(), 2 * 60_000).unref?.();
    sessions.on('data', (id) => {
      this.autoTrust(id);
      this.autoDismiss(id);
    });
    // Waiting is the normal resting state inside team work; the user hears about it through reports instead.
    sessions.quietWaiting = (s) =>
      s.role !== 'player' ||
      this.pending.has(s.id) ||
      this.outbox.has(s.id) ||
      // a player with a coach or head coach above it: they hear about it, the user gets their reports instead
      this.coachOf(s.projectId) !== undefined ||
      this.all().some((h) => h.role === 'head' && h.projectId === this.rootOf(s.projectId));
    this.restore();
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
    if (this.trustAnswered.has(key)) return;
    // cheap checks first: this runs on every output chunk
    if (!this.trustable(s)) return;
    const out = this.sessions.outputSinceInput(id);
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

  /** Top-level project of a project or part ('' — the team-wide head coach — stays ''). */
  private rootOf(projectId: string): string {
    if (!projectId) return '';
    return this.project(projectId)?.parentId ?? projectId;
  }

  /** The head coach of a top-level project, else the team-wide one (projectId '') if there is one. */
  headOf(rootId: string): StoredSession | undefined {
    const heads = this.all().filter((s) => s.role === 'head');
    return heads.find((s) => s.projectId === rootId && rootId !== '') ?? heads.find((s) => s.projectId === '');
  }

  /** Who receives an order for a project: project → its head coach, else its parts' leads; part → its lead. */
  private recipientsFor(projectId: string): StoredSession[] {
    const p = this.project(projectId);
    if (!p) return [];
    if (p.parentId) {
      const lead = this.leadOf(p.id);
      return lead ? [lead] : [];
    }
    const head = this.all().find((s) => s.role === 'head' && s.projectId === p.id);
    if (head) return [head];
    const parts = this.store.listProjects().filter((x) => x.parentId === p.id);
    return [p, ...parts].map((x) => this.leadOf(x.id)).filter((x): x is StoredSession => x !== undefined);
  }

  private coachOf(projectId: string): StoredSession | undefined {
    return this.all().find((s) => s.role === 'coach' && s.projectId === projectId);
  }

  /** Who takes a project-level order: its coach, else its first player. */
  private leadOf(projectId: string): StoredSession | undefined {
    return this.coachOf(projectId) ?? this.all().filter((s) => s.role === 'player' && s.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  private project(id: string): Project | undefined {
    return this.store.listProjects().find((p) => p.id === id);
  }

  /** The top-level project a project id belongs to (a part's project; a project is its own; none for the team head). */
  private rootProject(id: string): Project | undefined {
    const p = this.project(id);
    return p?.parentId ? this.project(p.parentId) : p;
  }

  /* ---------- folders, creation, launch ---------- */

  private teamDir(): string {
    return ensureDir(path.join(dataDir(), 'team'));
  }

  /** Write a generated instruction file unless the user took it over (removed the marker line). */
  private writeInstructions(file: string, content: string): void {
    let cur: string | undefined;
    try {
      cur = fs.readFileSync(file, 'utf8');
    } catch {
      /* missing */
    }
    // pre-marker files from the "manager" design are regenerated too
    if (cur === undefined || cur.startsWith(GENERATED_MARK) || /^# Role: (?:Manager|Coach)/.test(cur)) {
      if (cur !== content) fs.writeFileSync(file, content);
    }
  }

  /**
   * A project (and its parts) is being deleted: forget its sessions' queues, and remove what AgentO made for it — the
   * head coach / coach folders under the app's team folder and the sessions' MCP configs. The project's own folders
   * (the user's code) and the CLIs' conversation files are never touched.
   */
  forgetProject(projectIds: string[], sessionIds: string[]): void {
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

  /** Head coach folder: team/head-<projectId> (team/head-coach for the team-wide one). */
  headDir(projectId: string, cwd?: string): string {
    const dir = ensureDir(cwd ?? path.join(this.teamDir(), projectId ? `head-${projectId}` : 'head-coach'));
    this.writeInstructions(path.join(dir, 'CLAUDE.md'), headMd(projectId ? this.project(projectId) : undefined, this.store.listProjects()));
    return dir;
  }

  coachDir(project: Project): string {
    const dir = ensureDir(path.join(this.teamDir(), `coach-${project.id}`));
    for (const name of Object.values(INSTRUCTION_FILES)) this.writeInstructions(path.join(dir, name), coachMd(project));
    return dir;
  }

  /** The session's project (or the project its part belongs to) is closed: nothing wakes it or is delivered to it. */
  isClosed(projectId: string): boolean {
    if (!projectId) return false;
    const root = this.rootOf(projectId);
    return this.store.listProjects().some((p) => p.id === root && p.closed === true);
  }

  /** A folder a part may use: an existing project folder or a subfolder of one (it inherits the auto-trust). */
  private checkFolder(top: Project, p: string): { path: string; autoTrust: boolean } {
    if (!p.trim()) throw new ToolError('Give a folder path');
    const full = path.resolve(p);
    const parent = top.folders.find((f) => {
      const base = path.resolve(f.path).toLowerCase();
      return full.toLowerCase() === base || full.toLowerCase().startsWith(base + path.sep);
    });
    if (!parent) throw new ToolError(`${full} is not inside the project's folders (${top.folders.map((f) => f.path).join(', ')})`);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new ToolError(`${full} does not exist`);
    return { path: full, autoTrust: parent.autoTrust === true };
  }

  /**
   * Move a session into a project / part (keeping its folder and conversation; the folder is registered there), and
   * put it before `beforeId` among that part's sessions (else last). Same part: only the order changes.
   */
  moveSession(id: string, destId: string, beforeId?: string): void {
    const t = this.sessions.get(id);
    const projects = this.store.listProjects();
    const dest = projects.find((p) => p.id === destId);
    if (!t || !dest) throw new Error('Session or project not found');
    if (t.role === 'head') throw new Error('The head coach stays at the project level');
    const fromRoot = this.rootOf(t.projectId);
    if (t.projectId !== dest.id) {
      if (!t.folderId) throw new Error(`"${t.title}" is a dedicated coach (its own folder) and cannot be moved`);
      if (t.role === 'coach') this.sessions.setRole(t.id, 'player'); // a part's coach does not lead the next one
      const path0 = projects.flatMap((p) => p.folders).find((f) => f.id === t.folderId)?.path;
      if (!path0) throw new Error(`The folder of "${t.title}" is not registered`);
      const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
      const folder = dest.folders.find((f) => same(f.path, path0)) ?? this.store.addFolder(dest.id, path0, path.basename(path0) || path0);
      this.sessions.moveTo(t.id, dest.id, folder.id);
      this.onProjects();
    }
    // the part's order: everyone but the head coach, the moved one put before `beforeId`
    const key = (s: StoredSession): number => s.order ?? Number.MAX_SAFE_INTEGER;
    const members = this.all()
      .filter((s) => s.projectId === dest.id && s.role !== 'head' && s.id !== id)
      .sort((a, b) => key(a) - key(b) || a.createdAt - b.createdAt);
    const at = beforeId ? members.findIndex((s) => s.id === beforeId) : -1;
    members.splice(at >= 0 ? at : members.length, 0, this.sessions.get(id)!);
    members.forEach((s, i) => this.sessions.setOrder(s.id, i + 1));
    this.arrange(this.rootOf(dest.id));
    if (fromRoot !== this.rootOf(dest.id)) this.arrange(fromRoot);
  }

  /** Lay out one project's cards like Auto Arrange (head coach on top, a block per part). */
  arrange(rootId: string): void {
    const projects = this.store.listProjects();
    const ids = new Set([rootId, ...projects.filter((p) => p.parentId === rootId).map((p) => p.id)]);
    const all = this.all();
    for (const [id, r] of arrangeTeam(all, projects)) {
      const s = this.sessions.get(id);
      if (s && ids.has(s.projectId)) this.sessions.update(id, r);
    }
  }

  /** After a daemon restart, bring the head coaches back (they run their projects' daily cycle). */
  resumeHeads(): void {
    for (const h of this.all().filter((s) => s.role === 'head')) {
      if (this.isClosed(h.projectId)) continue;
      if (this.sessions.isLive(h.id) || !(h.status === 'hibernated' || h.status === 'error' || h.status === 'done')) continue;
      try {
        this.sessions.resume(h.id);
      } catch (e) {
        log.warn('team: head coach resume failed', h.title, e);
      }
    }
  }

  /** One head coach per top-level project ('' = a team-wide head coach, the earlier design). */
  createHead(projectId = ''): Session {
    const project = projectId ? this.project(projectId) : undefined;
    if (projectId && !project) throw new Error('Project not found');
    if (project?.parentId) throw new Error('A head coach belongs to a project, not to a part');
    if (this.all().some((s) => s.role === 'head' && s.projectId === projectId)) throw new Error('That project already has a head coach');
    const head = this.sessions.create({
      projectId,
      folderId: '',
      cwd: this.headDir(projectId),
      agent: 'claude',
      role: 'head',
      title: project ? `Coach · ${project.name}` : 'Head Coach'
    });
    // its place in the team layout right away (a new project: the next spot in the grid), as Auto Arrange would
    if (projectId) this.arrange(projectId);
    return head;
  }

  createCoach(projectId: string, agent: AgentKind = 'claude'): Session {
    const project = this.project(projectId);
    if (!project) throw new Error('Project not found');
    if (this.coachOf(projectId)) throw new Error(`"${project.name}" already has a coach`);
    if (!(COACH_AGENTS as readonly string[]).includes(agent)) throw new Error(`A coach cannot run on ${agent}`);
    return this.sessions.create({ projectId, folderId: '', cwd: this.coachDir(project), agent, role: 'coach', title: `Coach · ${project.name}` });
  }

  /** Player ⇄ playing coach. A dedicated coach (own folder) cannot become a player. */
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
    this.record(s, 'directive', { id: 'user', title: DIRECT }, text);
    if (this.pending.has(id)) return;
    // stopped: message() queues it and wakes the session; it is tracked when delivered
    if (!this.sessions.isLive(id)) {
      this.directNext.add(id);
      return;
    }
    this.trackDirective(id, 'user');
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
      const min = s.role === 'player' ? AUTO_MIN_CONTEXT : AUTO_MIN_CONTEXT_COORD;
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

  /** quiet: the note to the session waits for its next work instead of waking it (organizing stopped sessions) */
  setRole(id: string, role: SessionRole, quiet = false): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (role === s.role) return;
    const wake = quiet && !this.sessions.isLive(id) ? { wake: false } : {};
    if (role === 'coach') {
      if (s.role !== 'player') throw new Error('Only a player can become the playing coach');
      const project = this.project(s.projectId);
      if (!project) throw new Error('Project not found');
      if (this.coachOf(s.projectId)) throw new Error(`"${project.name}" already has a coach`);
      this.sessions.setRole(id, 'coach');
      this.enqueue(id, { text: PLAYING_COACH_NOTE(project.name), ...wake });
    } else if (role === 'player') {
      if (s.role !== 'coach' || !s.folderId) throw new Error('Only a playing coach can go back to being a player');
      this.sessions.setRole(id, 'player');
      this.handOver(s, wake);
      this.enqueue(id, {
        text: '[AgentO] You are a player again: do your own work. The head coach now manages this part directly — report_up goes to it.',
        ...wake
      });
    } else {
      throw new Error('Use the Head Coach button to create the head coach');
    }
  }

  /**
   * A coach stepped down: the work it handed out now reports to the head coach (pending reports, report_up), and the
   * head coach is told which players it manages directly from now on and what is still out.
   */
  private handOver(coach: StoredSession, wake: { wake?: boolean }): void {
    const head = this.headOf(this.rootOf(coach.projectId));
    if (!head) return;
    const out: string[] = [];
    for (const [target, p] of this.pending) {
      if (p.from !== coach.id) continue;
      p.from = head.id;
      out.push(`- ${this.sessions.get(target)?.title ?? target} (session ${target})`);
    }
    for (const [target, from] of this.director) if (from === coach.id) this.director.set(target, head.id);
    const part = this.project(coach.projectId);
    const players = this.all().filter((x) => x.projectId === coach.projectId && x.role === 'player');
    this.enqueue(head.id, {
      text:
        `[AgentO] "${coach.title}" is no longer the coach of the part "${part?.name ?? coach.projectId}" (it is a player again). ` +
        `You manage that part's players directly now: ${players.map((x) => `"${x.title}"`).join(', ') || '(none)'}.` +
        (out.length ? `\nStill working on tasks the coach sent — their reports come to you:\n${out.join('\n')}` : '') +
        `\nNo reply needed.`,
      ...wake
    });
  }

  private mcpUrl(s: StoredSession): string {
    return `http://127.0.0.1:${this.conn.port}/mcp/${s.id}`;
  }

  /** Folders a coach (its project's) or the head coach (every project's, it keeps the WBS) may read and edit. */
  private projectFolders(s: StoredSession): string[] {
    if (s.role === 'head') {
      const tree = this.store.listProjects().filter((p) => !s.projectId || this.rootOf(p.id) === s.projectId);
      return [...new Set(tree.flatMap((p) => p.folders.map((f) => f.path)))];
    }
    if (s.role !== 'coach') return [];
    return (this.project(s.projectId)?.folders ?? []).filter((f) => f.id !== s.folderId).map((f) => f.path);
  }

  /**
   * Environment per launch: Codex reads the MCP bearer token from TOKEN_ENV. Gemini in a folder AgentO made for it
   * (a dedicated coach) skips its folder-trust prompt — untrusted folders also ignore the .gemini settings with the MCP
   * connection.
   */
  launchEnv(s: StoredSession): Record<string, string> {
    if (s.agent === 'codex') return { [TOKEN_ENV]: this.conn.token };
    // coordinators compact their conversation early: a long context is re-read on every call
    if (s.agent === 'claude' && s.role !== 'player' && COORDINATOR_COMPACT_PCT) return { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: COORDINATOR_COMPACT_PCT };
    if (s.agent === 'gemini' && s.role !== 'player' && !s.folderId) return { GEMINI_CLI_TRUST_WORKSPACE: 'true' };
    return {};
  }

  /**
   * Extra CLI args per launch: the MCP connection and (dedicated coach) the project folders.
   * - claude: --mcp-config file, tools pre-allowed (every role, players included)
   * - codex:  -c overrides (no quotes or spaces, so they survive Windows command-line quoting); token from env
   * - gemini: settings file .gemini/settings.json — only for coaches (it lives in the working folder, and a player's
   *           working folder is the user's project)
   */
  launchExtras(s: StoredSession): string[] {
    if (s.role === 'head') this.headDir(s.projectId, s.cwd);
    if (s.role === 'coach' && !s.folderId) {
      const project = this.project(s.projectId);
      if (project) this.coachDir(project);
    }
    if (s.agent === 'codex') {
      const key = `mcp_servers.${MCP_SERVER_NAME}`;
      return [
        '-c', `${key}.url=${this.mcpUrl(s)}`,
        '-c', `${key}.bearer_token_env_var=${TOKEN_ENV}`,
        '-c', `${key}.default_tools_approval_mode=auto`,
        '-c', `${key}.tool_timeout_sec=${TOOL_TIMEOUT_S}`,
        '-c', `${key}.startup_timeout_sec=20`,
        // a coach / head coach plans, delegates and reviews — it reads, it does not edit: a read-only sandbox where
        // commands run without asking (an approval prompt would stall the team; anything else fails in the sandbox)
        ...(s.role !== 'player' ? ['-c', 'approval_policy=never', '-c', 'sandbox_mode=read-only'] : []),
        // a player edits code like a Claude player does (no sandbox, the user's own rights): the Windows sandbox
        // ("unelevated") denies writes in large workspaces such as a folder of many repositories
        ...(s.role === 'player' ? ['-c', 'sandbox_mode=danger-full-access'] : []),
        // on Windows, first runs ask which sandbox to set up and wait there; without the user's own choice in
        // ~/.codex/config.toml, take the one that needs no administrator rights
        ...(process.platform === 'win32' && !codexSandboxChosen() ? ['-c', 'windows.sandbox=unelevated'] : []),
        ...(s.modelPref ? ['-c', `model=${s.modelPref}`] : [])
      ];
    }
    if (s.agent === 'gemini') {
      if (s.role === 'player' || s.folderId) return [];
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
    // the project memory: what every session of the project should know, read on every call (kept short by its caps)
    const root = this.rootProject(s.projectId);
    if (root) {
      ensureMemory(root.id, root.name);
      const mem = memorySystemPrompt(root.id, root.name);
      if (mem) extras.push('--append-system-prompt', mem);
    }
    if (s.role !== 'player') extras.push(...COORDINATOR_ARGS(s.modelPref));
    else if (s.modelPref) extras.push('--model', s.modelPref);
    return extras;
  }

  /* ---------- scope ---------- */

  /**
   * head coach → everything in its project (the team-wide one: everything) · coach → its part, the sibling parts'
   * coaches and its head coach · player → its part, and its head coach when the part has no coach.
   */
  private inScope(caller: StoredSession, target: StoredSession): boolean {
    if (target.id === caller.id) return false;
    if (caller.role === 'head') return !caller.projectId || (target.role !== 'head' && this.rootOf(target.projectId) === caller.projectId);
    const root = this.rootOf(caller.projectId);
    if (target.role === 'head') return target.id === this.headOf(root)?.id && (caller.role === 'coach' || !this.coachOf(caller.projectId));
    if (target.projectId === caller.projectId) return true;
    return caller.role === 'coach' && target.role === 'coach' && root !== '' && this.rootOf(target.projectId) === root;
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
      // say who can relay it, so the caller goes up the chain instead of giving up
      const up = caller.role === 'player' ? this.coachOf(caller.projectId) ?? this.headOf(this.rootOf(caller.projectId)) : caller.role === 'coach' ? this.headOf(this.rootOf(caller.projectId)) : undefined;
      const hint = up ? ` Ask "${up.title}" (id ${up.id}) to pass it on — use report_up or send_to_session to it.` : '';
      throw new ToolError(`Session "${t.title}" is outside your scope.${hint}`);
    }
    return t;
  }

  private describe(s: StoredSession, projects: Project[]): Json {
    return {
      session_id: s.id,
      title: s.title,
      role: s.role === 'coach' && s.folderId ? 'playing coach' : ROLE_NAME[s.role],
      agent: s.agent,
      project: s.projectId ? projectPath(s.projectId, projects) : '(team)',
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
    return s ? `"${s.title}" (${ROLE_NAME[s.role]}, session ${s.id})` : 'a removed session';
  }

  /** Team traffic record; `from` is a session or the user ('user'). */
  private record(target: StoredSession, kind: 'directive' | 'report', from: { id: string; title: string }, message: string, read = true): string {
    const text = `${from.title} → ${target.title}: ${clip(message.trim(), LOG_TEXT_MAX)}`;
    const item = this.store.addInbox(target.id, kind, text, read, from.id);
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

  private enqueue(targetId: string, item: Queued): void {
    const q = this.outbox.get(targetId) ?? [];
    q.push({ ...item, at: Date.now() });
    this.outbox.set(targetId, q);
    this.flush();
  }

  /** Deliver queued messages to idle targets; wake stopped ones; flag ones sitting on a prompt. */
  private flush(): void {
    for (const [id, queue] of this.outbox) {
      const t = this.sessions.get(id);
      if (!t || queue.length === 0) {
        this.outbox.delete(id);
        continue;
      }
      // a closed project keeps its queued messages until it is opened again
      if (this.isClosed(t.projectId)) continue;
      // only riders (a delegation note, a progress report): wait for something worth a turn — but not forever
      if (queue.every((q) => q.ride) && Date.now() - Math.min(...queue.map((q) => q.at ?? 0)) < RIDE_MAX_MS) continue;
      // reports for a head coach / coach: wait a little for the others (players finishing close together → one turn)
      if (t.role !== 'player' && queue.every((q) => q.report || q.ride) && Date.now() - Math.min(...queue.map((q) => q.at ?? 0)) < REPORT_BATCH_MS) continue;
      if (!this.sessions.isLive(id)) {
        if (queue.every((q) => q.wake === false)) continue; // only notes: they ride along with its next work
        if (!this.resuming.has(id) && t.status !== 'starting') {
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
      const text = queue.map((q) => q.text).join('\n\n');
      try {
        this.sessions.paste(id, text);
        // it still shows "waiting" for a moment: messages queued right after go together in the next paste
        this.notBefore.set(id, Math.max(this.notBefore.get(id) ?? 0, Date.now() + 3000));
        this.onDelivered(id, text);
      } catch (e) {
        log.warn('team: delivery failed', id, e);
        this.outbox.set(id, queue);
        continue;
      }
      const directive = [...queue].reverse().find((q) => q.from !== undefined);
      if (directive?.from) this.trackDirective(id, directive.from);
      // a head coach / coach got its players' results: what it makes of them goes up to whoever it works for (the
      // manager for a head coach) even if it forgets report_up — otherwise the outcome stays in its own conversation
      else if (t.role !== 'player' && queue.some((q) => q.report) && !this.pending.has(id)) {
        const up = this.director.get(id) ?? (t.role === 'head' ? 'user' : this.headOf(this.rootOf(t.projectId))?.id);
        if (up) this.trackDirective(id, up);
      }
    }
  }

  private trackDirective(targetId: string, from: string): void {
    const prev = this.pending.get(targetId);
    if (prev?.timer) clearTimeout(prev.timer);
    // a sender still waiting keeps waiting: the result goes to everyone who asked
    const also = prev ? [...new Set([...(prev.also ?? []), prev.from])].filter((x) => x !== from) : [];
    this.pending.set(targetId, { from, ...(also.length ? { also } : {}), at: Date.now(), started: false, timer: null });
    this.director.set(targetId, from);
  }

  private onStatus(s: Session): void {
    // a (re)started CLI draws its UI first; give it a moment before typing into it
    if (s.status === 'starting') this.notBefore.set(s.id, Math.max(this.notBefore.get(s.id) ?? 0, Date.now() + START_SETTLE_MS));
    const p = this.pending.get(s.id);
    if (s.status === 'waiting') setTimeout(() => this.flush(), 200);
    if (!p) return;
    if (s.status === 'working' || s.status === 'starting') {
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
        this.onInbox();
      }
      return;
    }
    // the message never reached the conversation (typed into a dialog, or not submitted): the last reply is an old
    // one — do not report it again as the answer; tell the manager once and keep waiting
    const taken = this.lastTakenAt(s);
    if (taken !== undefined && taken < p.at - 2000) {
      if (!p.blocked) {
        p.blocked = true;
        p.started = false;
        this.store.addInbox(s.id, 'waiting', `${s.title} — did not take the message (a dialog or prompt in its Terminal?): open it, close the dialog, and send again`);
        this.onInbox();
      }
      return;
    }
    this.pending.delete(s.id);
    for (const other of p.also ?? []) this.complete(s, { from: other, at: p.at, started: true, timer: null });
    const reply = this.lastReply(s, 1500);
    // a coach's turn usually ends after delegating, so it "replied"; a player's turn is the work itself
    const state = s.status !== 'waiting' ? `stopped (${s.status})` : s.role === 'player' ? 'finished' : 'replied';
    if (p.from === 'user') {
      // a coordinator that just handed the work on has no result yet: recorded as "handed on" (shown faintly, no alert)
      const shown = state === 'replied' && p.delegated ? 'handed on' : state;
      this.store.addInbox(s.id, 'report', `${s.title} ${shown}: ${clip(reply.trim(), LOG_TEXT_MAX) || '(no reply text)'}`, false, s.id);
      this.onInbox();
      return;
    }
    const sender = this.sessions.get(p.from);
    if (!sender) return;
    this.enqueue(sender.id, {
      text: `[AgentO] "${s.title}" (${ROLE_NAME[s.role]}, session ${s.id.slice(0, 8)}) ${state} the task you sent. Its last reply:\n${reply || '(no reply text)'}`,
      report: true,
      // a head coach / coach whose turn ended after handing the work on: its real result comes later with report_up —
      // this note rides along with that instead of costing the sender a turn now
      ...(state === 'replied' ? { ride: true } : {})
    });
    this.record(sender, 'report', s, `${state}: ${reply}`);
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
    if (list.length >= RATE_LIMIT[caller.role]) {
      throw new ToolError(
        `You sent ${list.length} messages in the last 10 minutes, the limit for a ${ROLE_NAME[caller.role]}. ` +
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
    const text = `[Message from ${this.label(caller.id)}]\n${message.trim()}`;
    if (directive) {
      const p = this.pending.get(caller.id);
      if (p) p.delegated = true;
    }
    this.enqueue(t.id, directive ? { text, from: caller.id } : ride ? { text, ride: true, report: true } : { text, report: true });
    this.record(t, directive ? 'directive' : 'report', caller, message);
    const queued = this.outbox.has(t.id);
    return (
      `${queued ? 'Queued for' : 'Delivered to'} "${t.title}"${queued ? ' (it is busy or stopped; delivered when it is idle)' : ''}.` +
      (directive ? ' You will get an "[AgentO] … finished" message when it is done.' : '')
    );
  }

  /** The user's order (Orders panel, or a routine run named by `via`). Returns the recipients' titles. */
  /** task: the manager added it as a task (it shows in Tasks even before any work is handed out) */
  order(target: TeamOrderTarget, message: string, via?: string, task = false): string[] {
    if (!message.trim()) throw new Error('The order is empty');
    const recipients: StoredSession[] = [];
    const closed = (projectId: string): boolean => this.isClosed(projectId);
    if (target.kind === 'session') {
      const s = this.sessions.get(target.sessionId);
      if (!s) throw new Error('Session not found');
      if (s.projectId && closed(s.projectId)) throw new Error('That project is closed — open it first');
      recipients.push(s);
    } else if (target.kind === 'project') {
      if (closed(target.projectId)) throw new Error('That project is closed — open it first');
      recipients.push(...this.recipientsFor(target.projectId));
      if (recipients.length === 0) throw new Error('That project has no head coach, coach or players yet');
    } else if (target.kind === 'projects') {
      const open = [...new Set(target.projectIds)].filter((id) => !closed(id));
      if (open.length === 0) throw new Error('Those projects are closed — open them first');
      for (const id of open) recipients.push(...this.recipientsFor(id));
      if (recipients.length === 0) throw new Error('Those projects have no head coach, coach or players yet');
    } else {
      const global = this.all().find((s) => s.role === 'head' && s.projectId === '');
      if (global) recipients.push(global);
      else for (const p of this.store.listProjects().filter((x) => !x.parentId && !x.closed)) recipients.push(...this.recipientsFor(p.id));
      if (recipients.length === 0) throw new Error('There is no head coach, coach or player to receive the order');
    }
    const projectName = (id: string): string => this.store.listProjects().find((p) => p.id === id)?.name ?? id;
    for (const r of recipients) {
      let text = `[Order from ${USER}${via ? ` — ${via}` : ''}]\n${message.trim()}`;
      if (target.kind === 'projects') {
        // the same order went to the other projects: each works on its own side; the manager joins the reports
        const others = [...new Set(target.projectIds)].filter((id) => id !== r.projectId && !closed(id)).map(projectName);
        if (others.length) text += `\n\n(The same order also went to: ${others.join(', ')}. Handle your project's side of it and report_up as usual.)`;
      }
      if (r.role === 'player' && target.kind !== 'session') {
        text += '\n\n(You are leading this order for your project: share the work with your teammates — list_sessions, send_to_session.)';
      }
      this.enqueue(r.id, { text, from: 'user' });
      const id = this.record(r, 'directive', { id: 'user', title: via ? `Manager (you) · ${via}` : 'Manager (you)' }, message);
      if (task) this.store.markTaskOrder(id);
    }
    this.lastRecipients = recipients.map((r) => r.id);
    return recipients.map((r) => r.title);
  }

  /* ---------- tools ---------- */

  private readonly tools: ToolDef[] = [
    {
      name: 'list_projects',
      description: 'Head coach only. List your project and its parts with folders, coach session and player count.',
      inputSchema: { type: 'object', properties: {} },
      roles: ['head'],
      run: (caller) => {
        const all = this.all();
        const projects = this.store.listProjects();
        const tree = projects.filter((p) => !caller.projectId || this.rootOf(p.id) === caller.projectId);
        const out = tree.map((p) => ({
          project_id: p.id,
          name: p.name,
          kind: p.parentId ? `part of ${projects.find((x) => x.id === p.parentId)?.name ?? '?'}` : 'project',
          folders: p.folders.map((f) => ({ folder_id: f.id, name: f.name, path: f.path })),
          coach_session_id: all.find((s) => s.role === 'coach' && s.projectId === p.id)?.id ?? null,
          players: all.filter((s) => s.role === 'player' && s.projectId === p.id).length
        }));
        return JSON.stringify(out, null, 2);
      }
    },
    {
      name: 'create_part',
      description:
        'Head coach only. Create a part of your project (an area of work such as planning, front-end, QA) — or return ' +
        'the existing part with that name. Its folders: `folders` (paths, a project folder or a subfolder of one), else ' +
        "the project's folders. Then create_session players in it or move_session sessions into it.",
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, folders: { type: 'array', items: { type: 'string' }, description: 'Optional folder paths' } },
        required: ['name']
      },
      roles: ['head'],
      run: (caller, args) => {
        const name = str(args['name']).trim();
        if (!name) throw new ToolError('Give the part a name');
        if (!caller.projectId) throw new ToolError('You are not the head coach of a project');
        const existing = this.store.listProjects().find((p) => p.parentId === caller.projectId && p.name === name);
        if (existing) return JSON.stringify({ part_id: existing.id, name, created: false, folders: existing.folders.map((f) => f.path) });
        const top = this.project(caller.projectId);
        if (!top) throw new ToolError('Your project is gone');
        const want = Array.isArray(args['folders']) ? (args['folders'] as unknown[]).map(str).filter(Boolean) : [];
        const folders = want.length ? want.map((p) => this.checkFolder(top, p)) : top.folders.map((f) => ({ path: f.path, autoTrust: f.autoTrust === true }));
        const part = this.store.createProject(name, caller.projectId);
        for (const f of folders) this.store.addFolder(part.id, f.path, path.basename(f.path) || f.path, f.autoTrust);
        this.onProjects();
        return JSON.stringify({ part_id: part.id, name, created: true, folders: folders.map((f) => f.path) });
      }
    },
    {
      name: 'create_project',
      description:
        "Team head coach only (the head coach that belongs to no project). Start a new project for an order that fits none of the existing ones: " +
        'the project, its folders (`folders` — existing paths; none: a new folder under ~/AgentO Projects/<name>), and its own head ' +
        'coach, which gets `brief` as its first order (what to build, how to proceed). With `plan` the new head coach reports its ' +
        'team and plan to the manager first and waits for the go. Returns the project and head coach ids. For an order that ' +
        'belongs to an existing project, send_to_session that project\'s head coach instead (list_projects, list_sessions).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          folders: { type: 'array', items: { type: 'string' }, description: 'Optional existing folder paths' },
          brief: { type: 'string', description: 'The first order for the new head coach' },
          plan: { type: 'boolean', description: 'Report the plan first and wait for the go (default true)' }
        },
        required: ['name', 'brief']
      },
      roles: ['head'],
      run: (caller, args) => {
        if (caller.projectId) throw new ToolError('Only the team head coach starts projects; you lead one project. Ask the manager with report_up.');
        const name = str(args['name']).trim();
        const brief = str(args['brief']).trim();
        if (!name || !brief) throw new ToolError('Give the project a name and a brief');
        const folders = Array.isArray(args['folders']) ? (args['folders'] as unknown[]).map(str).filter(Boolean) : [];
        let head: Session;
        try {
          head = this.startProject(name, folders, brief, args['plan'] !== false);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        const project = this.store.listProjects().find((p) => !p.parentId && p.name === name);
        return JSON.stringify({ project_id: project?.id ?? '', name, head_coach_id: head.id, head_coach: head.title, folders: project?.folders.map((f) => f.path) ?? [] });
      }
    },
    {
      name: 'add_part_folder',
      description:
        "Head coach only. Add a folder to a part (a project folder or a subfolder of one, e.g. the part's module), so " +
        'its players can be created there.',
      inputSchema: { type: 'object', properties: { part_id: { type: 'string' }, path: { type: 'string' } }, required: ['part_id', 'path'] },
      roles: ['head'],
      run: (caller, args) => {
        const top = this.project(caller.projectId);
        const part = this.store.listProjects().find((p) => p.id === str(args['part_id']) && p.parentId === caller.projectId);
        if (!top || !part) throw new ToolError('No such part in your project. Use list_projects.');
        const f = this.checkFolder(top, str(args['path']));
        if (part.folders.some((x) => path.resolve(x.path).toLowerCase() === path.resolve(f.path).toLowerCase())) return `"${part.name}" already has ${f.path}.`;
        this.store.addFolder(part.id, f.path, path.basename(f.path) || f.path, f.autoTrust);
        this.onProjects();
        return `Added ${f.path} to "${part.name}".`;
      }
    },
    {
      name: 'move_session',
      description:
        'Head coach only. Move a session of your project into one of its parts (part_id from create_part / ' +
        'list_projects), or back to the project itself (part_id = the project id). It keeps its folder and conversation ' +
        'and is not woken.',
      inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, part_id: { type: 'string' } }, required: ['session_id', 'part_id'] },
      roles: ['head'],
      run: (caller, args) => {
        const t = this.target(caller, args);
        const partId = str(args['part_id']);
        const dest = this.store.listProjects().find((p) => p.id === partId && (p.id === caller.projectId || p.parentId === caller.projectId));
        if (!dest) throw new ToolError('No such part in your project. Use create_part or list_projects.');
        if (t.projectId === dest.id) return `"${t.title}" is already in "${dest.name}".`;
        try {
          this.moveSession(t.id, dest.id);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        return `Moved "${t.title}" into "${dest.name}".`;
      }
    },
    {
      name: 'make_coach',
      description:
        "Head coach only. Make a player the playing coach of its part (one per part): it keeps its own work and also " +
        'manages the part. It is told the next time it gets work — not woken now. role "player" turns a playing coach ' +
        'back into a player. Rarely needed: you manage the players yourself; only a part with 4 or more players that ' +
        'needs constant review gets a coach.',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' }, role: { type: 'string', enum: ['coach', 'player'], description: 'Default coach' } },
        required: ['session_id']
      },
      roles: ['head'],
      run: (caller, args) => {
        const t = this.target(caller, args);
        const role = str(args['role']) === 'player' ? 'player' : 'coach';
        try {
          this.setRole(t.id, role, true);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        this.arrange(caller.projectId);
        return `"${t.title}" is now ${role === 'coach' ? 'the playing coach' : 'a player'} of "${this.project(t.projectId)?.name ?? '?'}".`;
      }
    },
    {
      name: 'rename_session',
      description: 'Head coach only. Give a session a short, clear title (what it works on).',
      inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, title: { type: 'string' } }, required: ['session_id', 'title'] },
      roles: ['head'],
      run: (caller, args) => {
        const t = this.target(caller, args);
        const title = str(args['title']).trim().slice(0, 60);
        if (!title) throw new ToolError('The title is empty');
        const old = t.title;
        this.sessions.update(t.id, { title });
        return `Renamed "${old}" to "${title}".`;
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
          project_id: { type: 'string', description: 'team head coach only: which project' }
        },
        required: ['section', 'text']
      },
      roles: ['head', 'coach', 'player'],
      run: (caller, args) => {
        const root = caller.projectId ? this.rootProject(caller.projectId) : this.rootProject(str(args['project_id']));
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
        'List the sessions you can work with (your teammates, coach, or the teams you manage) with role, project and ' +
        'status (starting, working, waiting = idle or needs input, done, error, hibernated).',
      inputSchema: { type: 'object', properties: { project_id: { type: 'string', description: 'Only this project (optional)' } } },
      roles: ['head', 'coach', 'player'],
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
      roles: ['head', 'coach', 'player'],
      run: (caller, args) => {
        const t = this.target(caller, args);
        const source = str(args['source']) || 'auto';
        const max = Math.max(1, Math.min(200, Math.floor(num(args['max_entries'], 10))));
        const head = `"${t.title}" — ${ROLE_NAME[t.role]}, status ${t.status}${this.sessions.isLive(t.id) ? '' : ' (not running)'}`;
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
      roles: ['head', 'coach', 'player'],
      run: (caller, args) => this.send(caller, this.target(caller, args), str(args['message']), args['directive'] !== false)
    },
    {
      name: 'report_up',
      description:
        'Report progress or ask a question to whoever gave you your latest order or directive (the manager — the ' +
        'user — or a session). Without one: a player → its coach (or the head coach, or the manager), a coach → the ' +
        'head coach (or the manager), the head coach → the manager.',
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      roles: ['head', 'coach', 'player'],
      run: (caller, args) => {
        const message = str(args['message']).trim();
        if (!message) throw new ToolError('message is empty');
        const d = this.director.get(caller.id);
        const byRole = (): StoredSession | undefined =>
          caller.role === 'player'
            ? this.coachOf(caller.projectId) ?? this.headOf(this.rootOf(caller.projectId))
            : caller.role === 'coach'
              ? this.headOf(this.rootOf(caller.projectId))
              : undefined;
        const up = d === 'user' ? undefined : (d && this.sessions.get(d)) || byRole();
        if (!up || up.id === caller.id) {
          this.checkRate(caller);
          // it reported explicitly: no automatic copy of its last reply when the turn ends
          if (this.pending.get(caller.id)?.from === 'user') this.pending.delete(caller.id);
          this.store.addInbox(caller.id, 'report', `${caller.title} → Manager (you): ${clip(message, LOG_TEXT_MAX)}`, false, caller.id);
          this.onInbox();
          return 'Sent to the manager (the user). Their answer, if any, arrives as an "[Order from …]" message.';
        }
        // still working on a task from them: the report goes along with the "finished" message, not as a turn of its own
        const riding = this.pending.get(caller.id)?.from === up.id && caller.role === 'player';
        // a coordinator reporting up explicitly: no automatic copy of its last reply when the turn ends
        if (caller.role !== 'player' && this.pending.get(caller.id)?.from === up.id) this.pending.delete(caller.id);
        return this.send(caller, up, `(report) ${message}`, false, riding);
      }
    },
    {
      name: 'create_session',
      description:
        'Coaches and the head coach only. Start a new player (a Claude Code session) in a project folder, optionally ' +
        'with a first prompt (it reports back when done). A coach can only create players in its own project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Required for the head coach (a part of its project); a coach uses its own part' },
          folder: { type: 'string', description: 'Folder id, name or path in the project (default: first folder)' },
          title: { type: 'string' },
          prompt: { type: 'string', description: 'First instruction for the player' }
        }
      },
      roles: ['head', 'coach'],
      run: (caller, args) => {
        const pid = caller.role === 'coach' ? caller.projectId : str(args['project_id']);
        if (caller.role === 'coach' && str(args['project_id']) && str(args['project_id']) !== caller.projectId) {
          throw new ToolError('A coach can only create players in its own project.');
        }
        const project = this.project(pid);
        if (!project) throw new ToolError('Unknown project_id. Use list_projects.');
        if (caller.role === 'head' && caller.projectId && this.rootOf(project.id) !== caller.projectId) {
          throw new ToolError('That project/part is not yours. Use list_projects.');
        }
        const want = str(args['folder']);
        const folder = want
          ? project.folders.find((f) => f.id === want || f.name === want || path.resolve(f.path) === path.resolve(want))
          : project.folders[0];
        if (!folder) throw new ToolError(project.folders.length ? `No folder "${want}" in ${project.name}.` : `${project.name} has no folders yet.`);
        // All coding goes to Claude: players created by the team are always Claude Code sessions.
        const prompt = str(args['prompt']).trim();
        const s = this.sessions.create({
          projectId: project.id,
          folderId: folder.id,
          cwd: folder.path,
          agent: 'claude',
          role: 'player',
          ...(str(args['title']).trim() ? { title: str(args['title']).trim() } : {}),
          ...(prompt ? { prompt: `[Message from ${this.label(caller.id)}]\n${prompt}` } : {})
        });
        const stored = this.sessions.get(s.id);
        if (prompt && stored) {
          this.record(stored, 'directive', caller, prompt);
          this.trackDirective(stored.id, caller.id);
        }
        return JSON.stringify({ created: this.describe(stored ?? (s as StoredSession), this.store.listProjects()) }, null, 2);
      }
    },
    {
      name: 'wait_for_sessions',
      description:
        'Block until the given sessions (default: the players in your scope) are no longer working, or until the ' +
        'timeout. Usually not needed: you are told automatically when a session finishes what you sent.',
      inputSchema: {
        type: 'object',
        properties: {
          session_ids: { type: 'array', items: { type: 'string' } },
          timeout_seconds: { type: 'number', description: `Default 120, max ${MAX_WAIT_S}` }
        }
      },
      roles: ['head', 'coach', 'player'],
      run: async (caller, args) => {
        const ids = Array.isArray(args['session_ids']) ? (args['session_ids'] as unknown[]).map(str).filter(Boolean) : [];
        const targets = ids.length
          ? ids.map((id) => this.target(caller, { session_id: id }))
          : this.all().filter((s) => this.inScope(caller, s) && s.role === 'player');
        if (targets.length === 0) return 'No sessions to wait for.';
        const timeout = Math.min(MAX_WAIT_S, Math.max(5, num(args['timeout_seconds'], 120))) * 1000;
        const started = Date.now();
        const busy = (s: StoredSession): boolean => this.busy(s.id);
        // Idle must hold for a moment: the status detector flips to waiting on short output pauses.
        let idleSince = 0;
        while (Date.now() - started < timeout) {
          if (targets.some(busy)) idleSince = 0;
          else if (!idleSince) idleSince = Date.now();
          else if (Date.now() - idleSince >= 3000) break;
          await sleep(1000);
        }
        const timedOut = targets.some(busy);
        const states = targets.map((s) => {
          const cur = this.sessions.get(s.id);
          return cur ? { session_id: cur.id, title: cur.title, status: cur.status } : { session_id: s.id, status: 'removed' };
        });
        return `${timedOut ? 'Timed out; some sessions are still working.' : 'All idle.'}\n${JSON.stringify(states, null, 2)}`;
      }
    },
    {
      name: 'interrupt_session',
      description: 'Coaches and the head coach only. Interrupt what a session is doing (Esc for Claude, Ctrl+C otherwise).',
      inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
      roles: ['head', 'coach'],
      run: (caller, args) => {
        const t = this.target(caller, args);
        if (!this.sessions.isLive(t.id)) throw new ToolError(`"${t.title}" is not running.`);
        this.sessions.input(t.id, t.agent === 'claude' ? '\x1b' : '\x03');
        return `Interrupted "${t.title}".`;
      }
    },
    {
      name: 'resume_session',
      description: 'Coaches and the head coach only. Start a hibernated/stopped session again (continues its conversation).',
      inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
      roles: ['head', 'coach'],
      run: async (caller, args) => {
        const t = this.target(caller, args);
        if (this.sessions.isLive(t.id)) return `"${t.title}" is already running.`;
        this.sessions.resume(t.id);
        const until = Date.now() + 30_000;
        while (Date.now() < until && this.sessions.get(t.id)?.status !== 'waiting') await sleep(500);
        return `"${t.title}" is ${this.sessions.get(t.id)?.status ?? 'gone'}.`;
      }
    }
  ];

  /** Working, starting, or just directed and not yet picked up. */
  private busy(id: string): boolean {
    const cur = this.sessions.get(id);
    if (!cur) return false;
    if (cur.status === 'working' || cur.status === 'starting') return true;
    if (this.outbox.has(id)) return true;
    const p = this.pending.get(id);
    return p !== undefined && !p.started && Date.now() - p.at < PICKUP_GRACE_MS && this.sessions.isLive(id);
  }

  private instructions(s: StoredSession): string {
    if (s.role === 'player') return PLAYER_INSTRUCTIONS;
    // a head coach / dedicated coach has the team description in its CLAUDE.md already
    if (s.role === 'coach') return `AgentO team tools. You are the ${s.folderId ? 'playing coach' : 'coach'} of your project.${s.folderId ? ` ${TEAM_INTRO}` : ''}`;
    return 'AgentO team tools. You are the head coach (see your CLAUDE.md).';
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
        // only the tools this role may call: every listed tool is sent with each of the session's requests
        return rpcResult(id, {
          tools: this.tools
            .filter((t) => t.roles.includes(caller.role) && (t.name !== 'create_project' || !caller.projectId))
            .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === str(params['name']));
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${str(params['name'])}`);
        const args = (typeof params['arguments'] === 'object' && params['arguments'] !== null ? params['arguments'] : {}) as Json;
        try {
          if (!tool.roles.includes(caller.role)) {
            throw new ToolError(`${tool.name} is not available to a ${ROLE_NAME[caller.role]}. Ask your coach with report_up.`);
          }
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

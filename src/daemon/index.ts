/**
 * AgentO daemon.
 * Standalone Node process (no electron imports). Owns every PTY; UI clients attach via WebSocket.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DAEMON_PORT_DEFAULT, type ClientMessage, type ServerMessage, type Session } from '@shared/protocol';
import type { DaemonInfoFile } from '@shared/extra';
import { attachmentsDir, dataDir, ensureDir, daemonJsonPath, daemonLockPipe, logsDir } from './paths';
import { ensureMemory } from './memory';
import { log } from './log';
import { Store } from './store';
import { SessionManager } from './sessions';
import { CodexParser, findCodexRollout } from './codex';
import { CARD_PORTRAIT } from '@shared/layout';
import { detectAgents } from './agents';
import { collectUsage } from './usage';
import { gitChanged, listDir, readFileCapped, searchFiles, warmIndex, commitSubjects } from './fsapi';
import { TranscriptTail, findTranscript } from './transcript';
import { Team, REVIEWER_TITLE } from './team';
import { Routines } from './routines';
import { parseDemoCommand, runDemo } from './demo';
import { exportProject, importProject } from './projectfile';
import { importClaudeSessions, listClaudeSessions } from './claudeimport';
import { agentConnections } from './agentstatus';
import { usageReport } from './usagereport';
import { fixPathFromLoginShell } from '@shared/loginpath';

const REVIEWER_NOTE = (id: string): string => `
Review: the project has a Codex session "${REVIEWER_TITLE}" (session ${id.slice(0, 8)}) for cross-checking — a second
opinion from another model. Claude players do the work; Codex only reviews. When a piece of work is finished, before
you report it to the manager as done, send_to_session the reviewer what to check: the goal, the changed files or
commits, and how to verify. It reads and runs checks but does not edit files. Put its verdict in your report and send
real problems back to the player. Do not give it implementation work, and do not create other reviewers.
`;

/** New project from Orders: how the head coach is briefed (plan: report the plan first and wait for the go). */
const START_ORDER = (plan: boolean, brief: string, reviewer?: string): string =>
  `[New project]
You lead this new project. Below is the manager's brief.
1. Get the starting point from list_projects and a quick look at the top level of the folder(s) — do not read the
   code yourself (a player can survey it as its first task).
2. Design the team: 2–5 parts (areas of work, e.g. planning, front-end, back-end, QA) — create_part each one (give
   \`folders\` when a part works in a subfolder).
3. In each part create_session the players it needs (one per area of work, a short Korean title each). Do not give
   them a prompt yet.
4. Do not make coaches: you manage every part's players yourself (a coach that only relays your messages costs
   tokens and time). Only a part with 4 or more players that needs constant review may get one (make_coach).
${plan ? `5. report_up to the manager, in Korean: the parts, the players, the first tasks and the order of work. Then WAIT for
   the manager's go before sending anyone work.` : `5. Hand out the first tasks (send_to_session to the players), then
   report_up the team and the plan to the manager, in Korean.`}
${reviewer ? REVIEWER_NOTE(reviewer) : ''}
Brief from the manager:
${brief}`;

/** Session › New Chat: the project (and folder name) that holds the chat sessions, and what a chat is called. */
const CHATS = 'Chats';
const CHAT_GAP = 80;
const CHAT_NAMES: Partial<Record<string, string>> = { codex: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };

/** Organize Team: what the head coach is asked to do with a project's sessions. */
const ORGANIZE_ORDER = `[Organize the team]
The sessions of this project were brought in from VS Code / a terminal: they all sit directly under the project as
players, stopped. Organize them into a team:
1. list_sessions, then read_session (max_entries 3) for each one to learn what it works on. Reading does not start
   them — do not send_to_session anyone, that would wake them and cost tokens.
2. Group them by area of work into 2–6 parts (for example docs/analysis, front-end, back-end, QA/bugs, tools) and
   create_part each one.
3. move_session every session into its part. If a title is unclear, rename_session it (short, Korean).
4. Do not make coaches: you manage the parts' players yourself (a coach that only relays messages costs tokens
   and time). Only a part with 4 or more sessions that needs constant review may get one (make_coach).
5. Then report_up to the manager, in Korean: the parts, who is in each, and sessions that look
   finished or obsolete (candidates to remove). Do not hand out any work yet.`;

const HERE = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  for (const rel of ['../../package.json', '../package.json', '../../app/package.json']) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(HERE, rel), 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return process.env['ASM_VERSION'] || '0.0.0';
}

const VERSION = readVersion();

/* ---------- single instance ---------- */

/** Listen on the lock pipe; false when another daemon holds it. The server stays open for the process's life. */
let lockServer: import('node:net').Server | null = null;
function takeDaemonLock(): Promise<boolean> {
  return new Promise((resolve) => {
    const pipe = daemonLockPipe();
    const srv = net.createServer((c) => c.end());
    srv.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && process.platform !== 'win32') {
        // a socket file left by a crashed daemon: in use only if something answers on it
        const probe = net.connect(pipe);
        probe.once('connect', () => { probe.destroy(); resolve(false); });
        probe.once('error', () => {
          try { fs.unlinkSync(pipe); } catch { /* gone */ }
          srv.listen(pipe, () => { lockServer = srv; resolve(true); });
        });
        return;
      }
      resolve(false);
    });
    srv.listen(pipe, () => {
      lockServer = srv;
      resolve(true);
    });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readDaemonJson(): DaemonInfoFile | undefined {
  try {
    const raw = fs.readFileSync(daemonJsonPath(), 'utf8');
    const j = JSON.parse(raw) as Partial<DaemonInfoFile>;
    if (typeof j.port === 'number' && typeof j.token === 'string' && typeof j.pid === 'number') {
      return { port: j.port, token: j.token, pid: j.pid, version: j.version ?? '' };
    }
  } catch {
    /* none */
  }
  return undefined;
}

/* ---------- server ---------- */

/** One HTTP server per port: WebSocket upgrades for clients, plain HTTP for the team MCP endpoint. */
function listen(startPort: number, attempts = 11): Promise<{ server: http.Server; wss: WebSocketServer; port: number }> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, left: number) => {
      const server = http.createServer();
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeAllListeners();
        if (err.code === 'EADDRINUSE' && left > 1) {
          log.warn(`port ${port} in use, trying ${port + 1}`);
          tryPort(port + 1, left - 1);
        } else reject(err);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolve({ server, wss: new WebSocketServer({ server }), port });
      });
    };
    tryPort(startPort, attempts);
  });
}

/** The open projects' folders (a closed project's are left out). */
function openRoots(store: Store): string[] {
  const all = store.listProjects();
  const closed = new Set(all.filter((p) => !p.parentId && p.closed).map((p) => p.id));
  return all.filter((p) => !closed.has(p.id) && !(p.parentId && closed.has(p.parentId))).flatMap((p) => p.folders.map((f) => f.path));
}

async function main(): Promise<void> {
  ensureDir(dataDir());
  logsDir();
  log.info(`daemon starting v${VERSION} pid ${process.pid} data=${dataDir()}`);
  // macOS: launched from Finder/Dock the PATH is launchd's minimal one; take the login shell's so the agent CLIs resolve.
  if (process.platform === 'darwin') log.info(`PATH from login shell: ${fixPathFromLoginShell()}`);

  // one daemon per data folder: two would fight over the session holders (each takeover drops the other's pipe)
  if (!(await takeDaemonLock())) {
    log.info('another daemon holds the lock; exiting');
    log.close();
    process.exit(0);
  }
  const existing = readDaemonJson();
  if (existing && existing.pid !== process.pid && pidAlive(existing.pid)) {
    log.warn(`daemon.json names pid ${existing.pid}, which is alive but not the lock holder; replacing`);
  }

  const startPort = Number(process.env['ASM_PORT']) || DAEMON_PORT_DEFAULT;
  const { server, wss, port } = await listen(startPort);
  const token = randomBytes(32).toString('hex');
  const info: DaemonInfoFile = { port, token, pid: process.pid, version: VERSION };
  fs.writeFileSync(daemonJsonPath(), JSON.stringify(info, null, 2));
  log.info(`listening on ws://127.0.0.1:${port}`);
  // walk the project folders once in the background, so the first Quick Open / file link click answers at once
  setTimeout(() => warmIndex(openRoots(store)), 15_000);

  const store = new Store();
  // every open project has its memory file (the Files tab opens it; sessions get it at start)
  for (const p of store.listProjects()) if (!p.parentId) ensureMemory(p.id, p.name);
  const sessions = new SessionManager(store);
  let agents = detectAgents();

  /** authenticated clients -> attached session ids */
  const clients = new Map<WebSocket, Set<string>>();
  sessions.isAttached = (id) => {
    for (const set of clients.values()) if (set.has(id)) return true;
    return false;
  };
  /** what each window has selected, and when the manager last typed into each session: "in use" for auto fresh start */
  const selected = new Map<WebSocket, string | null>();
  const typedAt = new Map<string, number>();
  const typed = (id: string): void => void typedAt.set(id, Date.now());
  sessions.inUse = (id) => [...selected.values()].includes(id) || Date.now() - (typedAt.get(id) ?? 0) < 2 * 3600_000;
  // typed in this daemon's life, else the manager's last message in the records (a restart keeps the protection)
  sessions.typedAgo = (id) => Date.now() - (typedAt.get(id) ?? store.lastFromUserAt(id) ?? -Infinity);

  const sendTo = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of clients.keys()) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  /* Claude chat transcripts: one tail per session, keyed to the pinned Claude session id. */
  const chats = new Map<string, { claudeId: string; tail: TranscriptTail }>();
  const chatFor = (id: string): TranscriptTail | undefined => {
    const s = sessions.get(id);
    if (!s || (s.agent !== 'claude' && s.agent !== 'codex') || !s.resumeId) return undefined;
    const cur = chats.get(id);
    if (cur && cur.claudeId === s.resumeId) return cur.tail;
    cur?.tail.dispose();
    const claudeId = s.resumeId;
    const codex = s.agent === 'codex';
    const tail = new TranscriptTail(
      () => (codex ? findCodexRollout(claudeId) : findTranscript(s.cwd, claudeId)),
      (entries) => broadcast({ type: 'chat.upsert', id, entries }),
      codex ? new CodexParser() : undefined
    );
    chats.set(id, { claudeId, tail });
    return tail;
  };
  const dropChat = (id: string): void => {
    chats.get(id)?.tail.dispose();
    chats.delete(id);
  };

  sessions.on('upsert', (session) => {
    broadcast({ type: 'session.upsert', session });
    // new conversation (restart) → fresh transcript; tell clients to reset
    const cur = chats.get(session.id);
    if (cur && cur.claudeId !== session.resumeId) {
      dropChat(session.id);
      const tail = chatFor(session.id);
      broadcast({ type: 'chat.snapshot', id: session.id, entries: tail ? tail.parser.entries : [], available: Boolean(tail) });
    }
  });
  sessions.on('removed', (id) => {
    dropChat(id);
    broadcast({ type: 'session.removed', id });
  });
  sessions.on('data', (id, data) => broadcast({ type: 'session.data', id, data }));
  /*
   * Inbox changes go out as deltas, coalesced: the full list (up to 500 rows, often 1 MB+) is sent only at welcome.
   * Each row's signature is its read flag; anything new, changed or dropped since the last push is sent.
   */
  let sentInbox = new Map<string, boolean>(store.listInbox().map((i) => [i.id, i.read]));
  let inboxTimer: NodeJS.Timeout | null = null;
  /** A project with its parts, sessions, records, routines and team folders — never the project's folders on disk. */
  function deleteProject(projectId: string): void {
    const ids = new Set([projectId, ...store.listProjects().filter((p) => p.parentId === projectId).map((p) => p.id)]);
    const gone = sessions.list().filter((s) => ids.has(s.projectId)).map((s) => s.id);
    for (const id of gone) sessions.remove(id);
    store.purgeRecords(gone);
    for (const r of store.listRoutines()) {
      const t = r.target;
      const aimed = t.kind === 'project' ? [t.projectId] : t.kind === 'projects' ? t.projectIds : t.kind === 'session' ? [t.sessionId] : [];
      if (aimed.length && aimed.every((x) => ids.has(x) || gone.includes(x))) store.deleteRoutine(r.id);
    }
    team.forgetProject([...ids], gone);
    store.deleteProject(projectId);
    broadcast({ type: 'projects', projects: store.listProjects() });
    broadcast({ type: 'routines', routines: store.listRoutines() });
    pushInbox();
  }
  function pushInbox(): void {
    if (inboxTimer) return;
    inboxTimer = setTimeout(() => {
      inboxTimer = null;
      const items = store.listInbox();
      const now = new Map(items.map((i) => [i.id, i.read]));
      const upsert = items.filter((i) => sentInbox.get(i.id) !== i.read);
      const remove = [...sentInbox.keys()].filter((id) => !now.has(id));
      sentInbox = now;
      if (upsert.length || remove.length) broadcast({ type: 'inbox.delta', upsert, remove });
    }, 120);
  }
  sessions.on('inbox', () => pushInbox());

  const team = new Team(store, sessions, { port, token, version: VERSION }, () =>
    pushInbox()
  );
  sessions.launchExtras = (s) => team.launchExtras(s);
  sessions.launchEnv = (s) => team.launchEnv(s);
  team.onDelivered = (sessionId, text) => broadcast({ type: 'team.delivered', sessionId, text });
  team.onProjects = () => broadcast({ type: 'projects', projects: store.listProjects() });
  /** Orders › New project, and the team head coach's create_project tool: project + folders + head coach + the brief as its first order */
  const startProject = (rawName: string, folders: string[], text: string, plan: boolean, via = 'New project'): Session => {
    const name = rawName.trim();
    if (!name) throw new Error('Give the project a name');
    if (!text.trim()) throw new Error('Write the order for the new project');
    if (store.listProjects().some((p) => !p.parentId && p.name === name)) throw new Error(`A project named "${name}" already exists`);
    const dirs = [...new Set(folders.map((f) => path.resolve(f)))];
    // no folder picked: a new one, ~/AgentO Projects/<name> (a name that is not a valid folder name is cleaned up)
    if (dirs.length === 0) {
      const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'project';
      const dir = path.join(os.homedir(), 'AgentO Projects', safe);
      fs.mkdirSync(dir, { recursive: true });
      dirs.push(dir);
    }
    for (const d of dirs) if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error(`Folder does not exist: ${d}`);
    const project = store.createProject(name);
    // the team works here on the manager's order: trusted, so new players do not stop at the folder-trust prompt
    for (const d of dirs) store.addFolder(project.id, d, path.basename(d) || d, true);
    broadcast({ type: 'projects', projects: store.listProjects() });
    const head = team.createHead(project.id);
    // the cross-check reviewer: a Codex session in the project folder, stopped until the head coach sends it a review
    let reviewer: Session | undefined;
    try {
      const folder = store.listProjects().find((p) => p.id === project.id)?.folders[0];
      if (folder) {
        reviewer = sessions.restore({ projectId: project.id, folderId: folder.id, cwd: folder.path, agent: 'codex', role: 'player', title: REVIEWER_TITLE });
        team.arrange(project.id);
      }
    } catch (e) {
      log.warn('could not add the Codex reviewer', name, (e as Error).message);
    }
    team.order({ kind: 'session', sessionId: head.id }, START_ORDER(plan, text.trim(), reviewer?.id), via, true);
    broadcast({ type: 'orders.done', done: store.listDoneOrders(), tasks: store.listTaskOrders() });
    log.info('project started from an order', name, dirs.join(', '), via);
    return head;
  };
  team.startProject = (name, folders, brief, plan) => startProject(name, folders, brief, plan, 'New project · Head Coach');
  const routines = new Routines(store, team, (list) => broadcast({ type: 'routines', routines: list }));
  server.on('request', (req, res) => {
    if (!team.handleHttp(req, res)) res.writeHead(404).end();
  });

  let shuttingDown = false;
  const shutdown = (killSessions: boolean, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`shutdown (killSessions=${killSessions})`);
    try {
      for (const id of [...chats.keys()]) dropChat(id);
      sessions.dispose();
      routines.dispose();
      // a plain shutdown / restart keeps the sessions: their holders carry the processes to the next daemon
      if (killSessions) sessions.killAll();
      else sessions.detachAll();
      for (const ws of clients.keys()) {
        try {
          ws.close(1001, 'daemon shutdown');
        } catch {
          /* ignore */
        }
      }
      wss.close();
      server.close();
      store.close();
      lockServer?.close();
    } catch (e) {
      log.error('shutdown error', e);
    }
    try {
      const cur = readDaemonJson();
      if (!cur || cur.pid === process.pid) fs.rmSync(daemonJsonPath(), { force: true });
    } catch {
      /* ignore */
    }
    log.close();
    setTimeout(() => process.exit(code), 150);
  };

  const handle = async (ws: WebSocket, msg: ClientMessage): Promise<void> => {
    switch (msg.type) {
      case 'hello':
        return; // already authenticated
      case 'project.create': {
        let parentId = msg.parentId;
        if (parentId) {
          const parent = store.listProjects().find((p) => p.id === parentId);
          if (!parent) throw new Error('Project not found');
          parentId = parent.parentId ?? parent.id; // parts are one level deep
        }
        store.createProject(msg.name.trim() || (parentId ? 'New Part' : 'New Project'), parentId);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      }
      case 'project.close': {
        // stop every session of the project and its parts (resumable: Claude hibernates with its resume id), pause the
        // routines that order them; the layout and history stay in the store
        const top = store.listProjects().find((p) => p.id === msg.id);
        if (!top || top.parentId) throw new Error('Only a project (not a part) can be closed');
        const ids = new Set([top.id, ...store.listProjects().filter((p) => p.parentId === top.id).map((p) => p.id)]);
        const members = sessions.list().filter((s) => ids.has(s.projectId));
        for (const s of members) {
          if (!sessions.isLive(s.id)) continue;
          try {
            sessions.hibernate(s.id);
          } catch {
            sessions.kill(s.id); // no resume id yet: stop it; it can still be restarted
          }
        }
        const memberIds = new Set(members.map((s) => s.id));
        for (const r of routines.list()) {
          const hit =
            (r.target.kind === 'project' && ids.has(r.target.projectId)) ||
            (r.target.kind === 'projects' && r.target.projectIds.some((id) => ids.has(id))) ||
            (r.target.kind === 'session' && memberIds.has(r.target.sessionId));
          if (!hit || !r.enabled) continue;
          routines.save({ id: r.id, name: r.name, target: r.target, text: r.text, enabled: false, ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes ?? 60 }) });
        }
        store.setProjectClosed(top.id, true);
        broadcast({ type: 'projects', projects: store.listProjects() });
        log.info('project closed', top.name, `${members.length} session(s)`);
        return;
      }
      case 'project.export': {
        const { name, file } = exportProject({ store, sessions, team, routines }, msg.id);
        sendTo(ws, { type: 'project.exported', name, data: JSON.stringify(file, null, 2) });
        return;
      }
      case 'project.import': {
        const { project, missing } = importProject({ store, sessions, team, routines }, msg.data);
        broadcast({ type: 'projects', projects: store.listProjects() });
        pushInbox();
        log.info('project opened from file', project.name, missing ? `(${missing} folder(s) missing)` : '');
        if (missing) throw new Error(`Opened "${project.name}", but ${missing} of its folders do not exist on this PC — add them again or fix the paths.`);
        return;
      }
      case 'project.move':
        store.moveProject(msg.id, msg.beforeId);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      case 'session.move':
        team.moveSession(msg.id, msg.projectId, msg.beforeId);
        return;
      case 'chat.new': {
        // one "Chats" project and folder for every chat session, made the first time
        let chats = store.listProjects().find((p) => !p.parentId && p.name === CHATS);
        if (!chats) chats = store.createProject(CHATS);
        if (chats.closed) store.setProjectClosed(chats.id, false);
        const dir = path.join(os.homedir(), 'AgentO Projects', CHATS);
        fs.mkdirSync(dir, { recursive: true });
        const same = (a: string): boolean => path.resolve(a).toLowerCase() === path.resolve(dir).toLowerCase();
        const folder = chats.folders.find((f) => same(f.path)) ?? store.addFolder(chats.id, dir, CHATS, true);
        broadcast({ type: 'projects', projects: store.listProjects() });
        const name = CHAT_NAMES[msg.agent] ?? msg.agent;
        const projectId = chats.id;
        const n = sessions.list().filter((s) => s.projectId === projectId && s.agent === msg.agent).length + 1;
        // chats sit in one row above every other card on the Ground — next to the last chat, else above the top-left
        // of the rest — and never on top of a card (older chats may sit among the projects)
        const chatSlot = (): { x: number; y: number } | undefined => {
          const all = sessions.list();
          if (!all.length) return undefined;
          const { w, h } = CARD_PORTRAIT;
          const free = (x: number, y: number): boolean => !all.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
          const mine = all.filter((s) => s.projectId === projectId);
          if (mine.length) {
            const last = mine.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
            if (free(last.x + last.w + CHAT_GAP, last.y)) return { x: last.x + last.w + CHAT_GAP, y: last.y };
          }
          const x0 = Math.min(...all.map((s) => s.x));
          const y = Math.min(...all.map((s) => s.y)) - h - CHAT_GAP * 4;
          for (let x = x0; ; x += w + CHAT_GAP) if (free(x, y)) return { x, y };
        };
        const session = sessions.create({ projectId, folderId: folder.id, cwd: dir, agent: msg.agent, role: 'player', title: `${name} chat ${n}`, at: chatSlot(), mode: 'tui' });
        clients.get(ws)?.add(session.id);
        sendTo(ws, { type: 'chat.created', id: session.id });
        return;
      }
      case 'session.message':
        typed(msg.id);
        team.message(msg.id, msg.text);
        return;
      case 'session.note':
        team.note(msg.id, msg.text);
        return;
      case 'session.paste':
        typed(msg.id);
        sessions.paste(msg.id, msg.text);
        return;
      case 'ui.select':
        selected.set(ws, msg.id);
        return;
      case 'session.fresh':
        team.freshStart(msg.id, 'manual');
        return;
      case 'session.setModel':
        sessions.setModel(msg.id, msg.model);
        return;
      case 'session.setMode':
        sessions.setMode(msg.id, msg.mode);
        return;
      case 'session.permission':
        sessions.answerPermission(msg.id, msg.requestId, msg.allow, msg.message);
        return;
      case 'git.subjects':
        sendTo(ws, { type: 'git.subjects.result', subjects: await commitSubjects(msg.folders, msg.hashes) });
        return;
      case 'session.restorePrev':
        sessions.restorePrevious(msg.id);
        return;
      case 'attachment.save': {
        const maxEncodedLength = 4 * Math.ceil((20 * 1024 * 1024) / 3);
        if (msg.data.length > maxEncodedLength) throw new Error('The image is larger than 20 MB');
        const ext = (path.extname(msg.name).toLowerCase().match(/^\.(png|jpe?g|gif|webp|bmp)$/)?.[0]) ?? '.png';
        const buf = Buffer.from(msg.data, 'base64');
        if (buf.length === 0) throw new Error('The image is empty');
        if (buf.length > 20 * 1024 * 1024) throw new Error('The image is larger than 20 MB');
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const file = path.join(attachmentsDir(), `${stamp}-${randomBytes(3).toString('hex')}${ext}`);
        fs.writeFileSync(file, buf);
        sendTo(ws, { type: 'attachment.saved', ref: msg.ref, path: file });
        return;
      }
      case 'claude.sessions.list':
        sendTo(ws, { type: 'claude.sessions', path: msg.path, items: listClaudeSessions(msg.path, sessions) });
        return;
      case 'claude.sessions.import': {
        const added = importClaudeSessions(store, sessions, msg);
        log.info('imported Claude Code sessions', added.map((s) => s.title).join(', '));
        return;
      }
      case 'order.done':
        store.setOrderDone(msg.id, msg.done);
        broadcast({ type: 'orders.done', done: store.listDoneOrders(), tasks: store.listTaskOrders() });
        return;
      case 'project.rename': {
        const name = msg.name.trim();
        if (!name) throw new Error('The name is empty');
        const p = store.listProjects().find((x) => x.id === msg.id);
        if (!p) throw new Error('Project not found');
        if (store.listProjects().some((x) => x.id !== p.id && (x.parentId ?? '') === (p.parentId ?? '') && x.name === name)) throw new Error(`"${name}" already exists here`);
        store.renameProject(p.id, name);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      }
      case 'project.setColor':
        if (!/^#[0-9a-f]{6}$/i.test(msg.color)) throw new Error('Not a color');
        store.setProjectColor(msg.id, msg.color);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      case 'project.open': {
        // sessions stay stopped until they get work (a delivery wakes them); paused routines stay paused
        store.setProjectClosed(msg.id, false);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      }
      case 'project.delete': {
        deleteProject(msg.id);
        return;
      }
      case 'folder.add': {
        const p = path.resolve(msg.path);
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`Folder does not exist: ${p}`);
        store.addFolder(msg.projectId, p, path.basename(p) || p, msg.autoTrust === true);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      }
      case 'folder.remove': {
        for (const s of sessions.list()) if (s.folderId === msg.id) sessions.remove(s.id);
        store.removeFolder(msg.id);
        broadcast({ type: 'projects', projects: store.listProjects() });
        return;
      }
      case 'session.create': {
        const folder = store.getFolder(msg.folderId);
        if (!folder) throw new Error('Folder not found');
        const opts: Parameters<SessionManager['create']>[0] = {
          projectId: msg.projectId,
          folderId: msg.folderId,
          cwd: folder.path,
          agent: msg.agent
        };
        if (msg.title !== undefined) opts.title = msg.title;
        if (msg.command !== undefined) opts.command = msg.command;
        if (msg.args !== undefined) opts.args = msg.args;
        if (msg.cols !== undefined) opts.cols = msg.cols;
        if (msg.rows !== undefined) opts.rows = msg.rows;
        if (msg.mode !== undefined) opts.mode = msg.mode;
        const session = sessions.create(opts);
        // a project with a head coach is laid out as a team: the new card joins its part's rows
        const own = store.listProjects().find((p) => p.id === msg.projectId);
        const root = own?.parentId ?? own?.id;
        if (root && team.headOf(root)) team.arrange(root);
        clients.get(ws)?.add(session.id);
        return;
      }
      case 'project.start': {
        const head = startProject(msg.name, msg.folders, msg.text, msg.plan);
        clients.get(ws)?.add(head.id);
        return;
      }
      case 'team.organize': {
        // the head coach first (it organizes); then the order, in the manager's name
        const top = store.listProjects().find((p) => p.id === msg.projectId && !p.parentId);
        if (!top) throw new Error('Choose a project (not a part)');
        const head = sessions.list().find((s) => s.role === 'head' && s.projectId === top.id) ?? team.createHead(top.id);
        clients.get(ws)?.add(head.id);
        team.order({ kind: 'session', sessionId: head.id }, ORGANIZE_ORDER, 'Organize Team');
        return;
      }
      case 'usage.report': {
        const report = usageReport(
          sessions.list().map((s) => ({ id: s.id, ...(s.resumeId ? { resumeId: s.resumeId } : {}), title: s.title, role: s.role, agent: s.agent, projectId: s.projectId })),
          Math.min(90, Math.max(1, Math.floor(msg.days) || 7)),
          msg.outside
        );
        sendTo(ws, { type: 'usage.report', report });
        return;
      }
      case 'head.create': {
        const session = team.createHead(msg.projectId);
        clients.get(ws)?.add(session.id);
        return;
      }
      case 'session.setRole':
        team.setRole(msg.id, msg.role, msg.quiet === true);
        return;
      case 'team.order': {
        // the secret demo orders (/demo shop, /demo stop, /demo reset) set up / pause / remove the built-in demo team
        const demo = parseDemoCommand(msg.text);
        if (demo) {
          runDemo(demo, {
            store,
            sessions,
            team,
            routines,
            onProjects: () => broadcast({ type: 'projects', projects: store.listProjects() }),
            notify: (text, sessionId) => {
              store.addInbox(sessionId, 'report', text, false, sessionId);
              pushInbox();
            },
            deleteProject
          });
          return;
        }
        const to = team.order(msg.target, msg.text, undefined, msg.task === true);
        if (msg.task) broadcast({ type: 'orders.done', done: store.listDoneOrders(), tasks: store.listTaskOrders() });
        log.info('team order to', to);
        return;
      }
      case 'routine.save':
        routines.save(msg.routine);
        return;
      case 'routine.delete':
        routines.delete(msg.id);
        return;
      case 'routine.run':
        routines.run(msg.id);
        return;
      case 'coach.create': {
        const session = team.createCoach(msg.projectId, msg.agent);
        clients.get(ws)?.add(session.id);
        return;
      }
      case 'session.input':
        typed(msg.id);
        sessions.input(msg.id, msg.data);
        return;
      case 'session.resize':
        sessions.resize(msg.id, msg.cols, msg.rows);
        return;
      case 'session.attach': {
        if (!sessions.get(msg.id)) throw new Error('Session not found');
        clients.get(ws)?.add(msg.id);
        sendTo(ws, { type: 'session.scrollback', id: msg.id, data: sessions.scrollback(msg.id) });
        return;
      }
      case 'chat.subscribe': {
        const tail = chatFor(msg.id);
        sendTo(ws, { type: 'chat.snapshot', id: msg.id, entries: tail ? tail.parser.entries : [], available: Boolean(tail) });
        return;
      }
      case 'session.stop':
        sessions.stop(msg.id);
        return;
      case 'session.kill':
        sessions.kill(msg.id);
        return;
      case 'session.restart':
        sessions.restart(msg.id);
        return;
      case 'session.resume':
        sessions.resume(msg.id);
        return;
      case 'session.hibernate':
        sessions.hibernate(msg.id);
        return;
      case 'session.update':
        sessions.update(msg.id, msg.patch);
        return;
      case 'session.remove':
        sessions.remove(msg.id);
        for (const set of clients.values()) set.delete(msg.id);
        return;
      case 'inbox.read':
        store.markInboxRead(msg.id);
        pushInbox();
        return;
      case 'fs.search': {
        // the open projects' folders (a closed project's are left out)
        sendTo(ws, { type: 'fs.search.result', ref: msg.ref, items: await searchFiles(openRoots(store), msg.query) });
        return;
      }
      case 'fs.list': {
        const entries = await listDir(msg.path);
        sendTo(ws, { type: 'fs.list.result', path: msg.path, entries });
        return;
      }
      case 'fs.read': {
        const { content, truncated } = await readFileCapped(msg.path);
        sendTo(ws, { type: 'fs.read.result', path: msg.path, content, truncated });
        return;
      }
      case 'fs.changed': {
        const entries = await gitChanged(msg.cwd);
        sendTo(ws, { type: 'fs.changed.result', cwd: msg.cwd, entries });
        return;
      }
      case 'agents.status':
        agents = detectAgents(); // a CLI installed just now is picked up for new sessions too
        sendTo(ws, { type: 'agents.status', items: await agentConnections() });
        return;
      case 'usage.refresh':
        agents = detectAgents();
        broadcast({ type: 'usage', usage: collectUsage() });
        return;
      case 'daemon.shutdown':
        shutdown(msg.killSessions);
        return;
      default: {
        const t = (msg as { type?: string }).type;
        throw new Error(`Unknown message: ${t}`);
      }
    }
  };

  wss.on('connection', (ws) => {
    let authed = false;
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4001, 'hello timeout');
    }, 5000);

    ws.on('message', (raw: RawData) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        sendTo(ws, { type: 'error', message: 'invalid JSON' });
        return;
      }
      if (!authed) {
        if (msg.type !== 'hello' || msg.token !== token) {
          log.warn('rejected client: bad hello');
          ws.close(4003, 'unauthorized');
          return;
        }
        authed = true;
        clearTimeout(helloTimer);
        clients.set(ws, new Set());
        sendTo(ws, {
          type: 'welcome',
          daemonPid: process.pid,
          version: VERSION,
          projects: store.listProjects(),
          sessions: sessions.list(),
          inbox: store.listInbox(),
          usage: collectUsage(),
          agents,
          routines: routines.list(),
          doneOrders: store.listDoneOrders(),
          taskOrders: store.listTaskOrders()
        });
        log.info(`client connected (${msg.client}); clients=${clients.size}`);
        return;
      }
      handle(ws, msg).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        log.warn(`error handling ${msg.type}: ${message}`);
        sendTo(ws, { type: 'error', message, ref: msg.type });
      });
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      selected.delete(ws);
      if (clients.delete(ws)) log.info(`client disconnected; clients=${clients.size}`);
    });
    ws.on('error', (err) => log.warn('client socket error', err));
  });

  team.resumeHeads();

  // periodic usage refresh (cheap)
  setInterval(() => {
    if (clients.size > 0) broadcast({ type: 'usage', usage: collectUsage() });
  }, 60_000).unref();

  process.on('SIGINT', () => shutdown(false));
  process.on('SIGTERM', () => shutdown(false));
  process.on('SIGHUP', () => shutdown(false));
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (err) => {
    log.error('unhandledRejection', err);
  });
}

main().catch((err) => {
  log.error('fatal', err);
  log.close();
  process.exit(1);
});

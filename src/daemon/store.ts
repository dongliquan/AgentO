/**
 * Synchronous SQLite store (better-sqlite3) for projects, folders, sessions and inbox.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { PROJECT_COLORS, type Folder, type InboxItem, type Project, type Routine, type Session, type SessionRole, type SessionStatus, type AgentKind } from '@shared/protocol';
import { dbPath, ensureDir, dataDir } from './paths';
import { ensureMemory, memoryPath } from './memory';

interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
  parent_id: string | null;
  closed: number | null;
  color: string | null;
  sort_order: number | null;
}
interface FolderRow {
  id: string;
  project_id: string;
  path: string;
  name: string;
  auto_trust: number | null;
}
interface RoutineRow {
  id: string;
  name: string;
  target: string;
  text: string;
  every_min: number | null;
  daily_at: string | null;
  enabled: number;
  next_at: number;
  runs: number;
  last_run_at: number | null;
  created_at: number;
}
interface SessionRow {
  id: string;
  project_id: string;
  folder_id: string;
  cwd: string;
  agent: string;
  title: string;
  color: string | null;
  status: string;
  pid: number | null;
  resume_id: string | null;
  prev_resume_ids: string | null;
  model_pref: string | null;
  mode: string | null;
  created_at: number;
  updated_at: number;
  exit_code: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  command: string | null;
  args: string | null;
  role: string | null;
  sort_order: number | null;
}
interface InboxRow {
  id: string;
  session_id: string;
  kind: string;
  text: string;
  created_at: number;
  read: number;
  from_id: string | null;
  task_id: string | null;
}

/** Session plus the custom command/args used to create it (needed for restart). */
export interface StoredSession extends Session {
  command?: string;
  args?: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  color TEXT,
  status TEXT NOT NULL,
  pid INTEGER,
  resume_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  exit_code INTEGER,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 640,
  h REAL NOT NULL DEFAULT 400,
  cols INTEGER NOT NULL DEFAULT 100,
  rows INTEGER NOT NULL DEFAULT 30,
  command TEXT,
  args TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inbox_session ON inbox(session_id, created_at);
CREATE TABLE IF NOT EXISTS order_task (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_done (
  id TEXT PRIMARY KEY,
  done_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  text TEXT NOT NULL,
  every_min INTEGER,
  daily_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
`;

function rowToSession(r: SessionRow): StoredSession {
  const s: StoredSession = {
    id: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
    cwd: r.cwd,
    agent: r.agent as AgentKind,
    role: r.role === 'head' || r.role === 'coach' ? (r.role as SessionRole) : 'player',
    title: r.title,
    status: r.status as SessionStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    cols: r.cols,
    rows: r.rows
  };
  if (r.color != null) s.color = r.color;
  if (r.sort_order != null) s.order = r.sort_order;
  if (r.pid != null) s.pid = r.pid;
  if (r.resume_id != null) s.resumeId = r.resume_id;
  if (r.prev_resume_ids) {
    try {
      s.prevResumeIds = JSON.parse(r.prev_resume_ids) as string[];
    } catch {
      /* ignore */
    }
  }
  if (r.exit_code != null) s.exitCode = r.exit_code;
  if (r.model_pref) s.modelPref = r.model_pref;
  if (r.mode === 'headless' || r.mode === 'tui') s.mode = r.mode;
  if (r.command != null) s.command = r.command;
  if (r.args != null) {
    try {
      s.args = JSON.parse(r.args) as string[];
    } catch {
      /* ignore */
    }
  }
  return s;
}

function rowToFolder(f: FolderRow): Folder {
  return { id: f.id, projectId: f.project_id, path: f.path, name: f.name, ...(f.auto_trust ? { autoTrust: true } : {}) };
}

function rowToRoutine(r: RoutineRow): Routine {
  const out: Routine = {
    id: r.id,
    name: r.name,
    target: JSON.parse(r.target) as Routine['target'],
    text: r.text,
    enabled: r.enabled === 1,
    nextAt: r.next_at,
    runs: r.runs,
    createdAt: r.created_at
  };
  if (r.every_min != null) out.everyMinutes = r.every_min;
  if (r.daily_at != null) out.dailyAt = r.daily_at;
  if (r.last_run_at != null) out.lastRunAt = r.last_run_at;
  return out;
}

function rowToInbox(r: InboxRow): InboxItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind as InboxItem['kind'],
    text: r.text,
    createdAt: r.created_at,
    read: r.read === 1,
    ...(r.from_id ? { fromId: r.from_id } : {}),
    ...(r.task_id ? { taskId: r.task_id } : {})
  };
}

export class Store {
  private db: Database.Database;
  /** prepared statements by SQL text: better-sqlite3 compiles a statement on every prepare() */
  private stmts = new Map<string, Database.Statement>();
  /**
   * listProjects() result, rebuilt only after a project or folder write. The team logic asks for it many times per
   * event (scope checks, routing); callers treat the projects as read-only.
   */
  private projectsCache: Project[] | null = null;
  private inboxInserts = 0;

  private stmt(sql: string): Database.Statement {
    let st = this.stmts.get(sql);
    if (!st) this.stmts.set(sql, (st = this.db.prepare(sql)));
    return st;
  }

  constructor(file: string = dbPath()) {
    ensureDir(dataDir());
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Columns added after the first release. */
  /** Small JSON values that must survive a restart (the team's queues). */
  /** The next task id of a project ("#T12"): one counter per project, kept in kv. */
  nextTaskId(projectId: string): string {
    const counts = this.getKv<Record<string, number>>('tasks') ?? {};
    const n = (counts[projectId] ?? 0) + 1;
    counts[projectId] = n;
    this.setKv('tasks', counts);
    return `#T${n}`;
  }

  getKv<T>(key: string): T | undefined {
    const r = this.stmt('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!r) return undefined;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return undefined;
    }
  }
  setKv(key: string, value: unknown): void {
    this.stmt('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const cols = new Set((this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name));
    if (!cols.has('sort_order')) this.db.exec('ALTER TABLE sessions ADD COLUMN sort_order REAL');
    if (!cols.has('role')) this.db.exec("ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'player'");
    if (!cols.has('prev_resume_ids')) this.db.exec('ALTER TABLE sessions ADD COLUMN prev_resume_ids TEXT');
    if (!cols.has('model_pref')) this.db.exec('ALTER TABLE sessions ADD COLUMN model_pref TEXT');
    if (!cols.has('mode')) this.db.exec('ALTER TABLE sessions ADD COLUMN mode TEXT');
    const inboxCols = new Set((this.db.prepare('PRAGMA table_info(inbox)').all() as { name: string }[]).map((c) => c.name));
    if (!inboxCols.has('from_id')) this.db.exec('ALTER TABLE inbox ADD COLUMN from_id TEXT');
    if (!inboxCols.has('task_id')) this.db.exec('ALTER TABLE inbox ADD COLUMN task_id TEXT');
    const projectCols = new Set((this.db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name));
    if (!projectCols.has('parent_id')) this.db.exec('ALTER TABLE projects ADD COLUMN parent_id TEXT');
    if (!projectCols.has('closed')) this.db.exec('ALTER TABLE projects ADD COLUMN closed INTEGER');
    if (!projectCols.has('color')) this.db.exec('ALTER TABLE projects ADD COLUMN color TEXT');
    // projects from before colors: one each, in creation order
    const uncolored = this.db.prepare('SELECT id FROM projects WHERE parent_id IS NULL AND color IS NULL ORDER BY created_at').all() as { id: string }[];
    for (const { id } of uncolored) this.db.prepare('UPDATE projects SET color = ? WHERE id = ?').run(this.nextColor(), id);
    const folderCols = new Set((this.db.prepare('PRAGMA table_info(folders)').all() as { name: string }[]).map((c) => c.name));
    if (!projectCols.has('sort_order')) this.db.exec('ALTER TABLE projects ADD COLUMN sort_order REAL');
    if (!folderCols.has('auto_trust')) this.db.exec('ALTER TABLE folders ADD COLUMN auto_trust INTEGER NOT NULL DEFAULT 0');
    // the AI "manager" became the head coach (the user is the manager)
    this.db.exec("UPDATE sessions SET role = 'head' WHERE role = 'manager'");
    this.db.exec("UPDATE sessions SET title = 'Head Coach' WHERE role = 'head' AND title = 'Manager'");
    // a project's head coach is called "Coach" (the team-wide one stays "Head Coach")
    this.db.exec("UPDATE sessions SET title = 'Coach · ' || substr(title, 14) WHERE role = 'head' AND project_id <> '' AND title LIKE 'Head Coach · %'");
  }

  close(): void {
    this.db.close();
  }

  /* ---------- projects ---------- */

  listProjects(): Project[] {
    if (!this.projectsCache) this.projectsCache = this.readProjects();
    // a fresh array each call (callers filter/sort it); the project objects are shared and read-only
    return this.projectsCache.slice();
  }

  private readProjects(): Project[] {
    // the manager's order (dragged in the tree) first, then newer projects at the end
    const projects = this.stmt('SELECT * FROM projects ORDER BY sort_order IS NULL, sort_order, created_at').all() as ProjectRow[];
    const folders = this.stmt('SELECT * FROM folders ORDER BY rowid').all() as FolderRow[];
    const byProject = new Map<string, Folder[]>();
    for (const f of folders) {
      const list = byProject.get(f.project_id) ?? [];
      list.push(rowToFolder(f));
      byProject.set(f.project_id, list);
    }
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      folders: byProject.get(p.id) ?? [],
      ...(p.parent_id ? { parentId: p.parent_id } : {}),
      ...(p.closed ? { closed: true } : {}),
      ...(p.color ? { color: p.color } : {}),
      ...(p.parent_id ? {} : { memory: memoryPath(p.id) })
    }));
  }

  /** When the manager last sent this session something (an order or a direct message), from the records. */
  lastFromUserAt(sessionId: string): number | undefined {
    const r = this.stmt("SELECT MAX(created_at) AS at FROM inbox WHERE session_id = ? AND from_id = 'user'").get(sessionId) as { at: number | null } | undefined;
    return r?.at ?? undefined;
  }

  /** Move a project before another of its siblings (same parent), or to the end; the siblings are renumbered. */
  moveProject(id: string, beforeId?: string): void {
    const all = this.listProjects();
    const me = all.find((p) => p.id === id);
    if (!me) throw new Error('Project not found');
    const siblings = all.filter((p) => (p.parentId ?? null) === (me.parentId ?? null) && p.id !== id);
    const at = beforeId ? siblings.findIndex((p) => p.id === beforeId) : -1;
    siblings.splice(at < 0 ? siblings.length : at, 0, me);
    const set = this.db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
    this.db.transaction(() => siblings.forEach((p, i) => set.run(i, p.id)))();
    this.projectsCache = null;
  }

  /** The first project color no project uses yet (then they repeat, least used first). */
  private nextColor(): string {
    const used = (this.stmt('SELECT color FROM projects WHERE parent_id IS NULL AND color IS NOT NULL').all() as { color: string }[]).map((r) => r.color);
    const count = (c: string): number => used.filter((u) => u === c).length;
    return [...PROJECT_COLORS].sort((a, b) => count(a) - count(b) || PROJECT_COLORS.indexOf(a) - PROJECT_COLORS.indexOf(b))[0]!;
  }

  setProjectColor(id: string, color: string): void {
    this.projectsCache = null;
    this.stmt('UPDATE projects SET color = ? WHERE id = ? AND parent_id IS NULL').run(color, id);
  }

  setProjectClosed(id: string, closed: boolean): void {
    this.projectsCache = null;
    this.stmt('UPDATE projects SET closed = ? WHERE id = ?').run(closed ? 1 : 0, id);
  }

  /** parentId: create a part of that (top-level) project */
  createProject(name: string, parentId?: string): Project {
    this.projectsCache = null;
    const color = parentId ? undefined : this.nextColor();
    const p: Project = { id: randomUUID(), name, createdAt: Date.now(), folders: [], ...(parentId ? { parentId } : {}), ...(color ? { color } : {}) };
    this.stmt('INSERT INTO projects (id, name, created_at, parent_id, color) VALUES (?, ?, ?, ?, ?)').run(p.id, p.name, p.createdAt, parentId ?? null, color ?? null);
    if (!parentId) ensureMemory(p.id, p.name);
    return p;
  }

  /** Deletes the project and its parts. */
  renameProject(id: string, name: string): void {
    this.projectsCache = null;
    this.stmt('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
  }

  deleteProject(id: string): void {
    this.projectsCache = null;
    this.stmt('DELETE FROM projects WHERE parent_id = ?').run(id);
    this.stmt('DELETE FROM projects WHERE id = ?').run(id);
  }

  /* ---------- folders ---------- */

  addFolder(projectId: string, folderPath: string, name: string, autoTrust = false): Folder {
    this.projectsCache = null;
    const f: Folder = { id: randomUUID(), projectId, path: folderPath, name, ...(autoTrust ? { autoTrust } : {}) };
    this.stmt('INSERT INTO folders (id, project_id, path, name, auto_trust) VALUES (?, ?, ?, ?, ?)')
      .run(f.id, f.projectId, f.path, f.name, autoTrust ? 1 : 0);
    return f;
  }

  getFolder(id: string): Folder | undefined {
    const r = this.stmt('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
    return r ? rowToFolder(r) : undefined;
  }

  /* ---------- routines ---------- */

  /** The manager's orders marked done (Tasks), by order record id. */
  listDoneOrders(): Record<string, number> {
    const rows = this.stmt('SELECT id, done_at FROM order_done').all() as { id: string; done_at: number }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.done_at]));
  }

  /** The manager's orders added as tasks explicitly (Tasks › Add Task), by order record id. */
  listTaskOrders(): string[] {
    return (this.stmt('SELECT id FROM order_task').all() as { id: string }[]).map((r) => r.id);
  }

  markTaskOrder(id: string): void {
    this.stmt('INSERT OR IGNORE INTO order_task (id, created_at) VALUES (?, ?)').run(id, Date.now());
  }

  setOrderDone(id: string, done: boolean): void {
    if (done) this.stmt('INSERT OR REPLACE INTO order_done (id, done_at) VALUES (?, ?)').run(id, Date.now());
    else this.stmt('DELETE FROM order_done WHERE id = ?').run(id);
  }

  listRoutines(): Routine[] {
    return (this.stmt('SELECT * FROM routines ORDER BY created_at').all() as RoutineRow[]).map(rowToRoutine);
  }

  getRoutine(id: string): Routine | undefined {
    const r = this.stmt('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
    return r ? rowToRoutine(r) : undefined;
  }

  saveRoutine(r: Routine): void {
    this.stmt(
        `INSERT INTO routines (id, name, target, text, every_min, daily_at, enabled, next_at, runs, last_run_at, created_at)
         VALUES (@id, @name, @target, @text, @every_min, @daily_at, @enabled, @next_at, @runs, @last_run_at, @created_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, target=excluded.target, text=excluded.text,
           every_min=excluded.every_min, daily_at=excluded.daily_at, enabled=excluded.enabled, next_at=excluded.next_at,
           runs=excluded.runs, last_run_at=excluded.last_run_at`
      )
      .run({
        id: r.id,
        name: r.name,
        target: JSON.stringify(r.target),
        text: r.text,
        every_min: r.everyMinutes ?? null,
        daily_at: r.dailyAt ?? null,
        enabled: r.enabled ? 1 : 0,
        next_at: r.nextAt,
        runs: r.runs,
        last_run_at: r.lastRunAt ?? null,
        created_at: r.createdAt
      });
  }

  deleteRoutine(id: string): void {
    this.stmt('DELETE FROM routines WHERE id = ?').run(id);
  }

  updateFolder(id: string, folderPath: string, name: string): void {
    this.projectsCache = null;
    this.stmt('UPDATE folders SET path = ?, name = ? WHERE id = ?').run(folderPath, name, id);
  }

  removeFolder(id: string): void {
    this.projectsCache = null;
    this.stmt('DELETE FROM folders WHERE id = ?').run(id);
  }

  /* ---------- sessions ---------- */

  listSessions(): StoredSession[] {
    return (this.stmt('SELECT * FROM sessions ORDER BY created_at').all() as SessionRow[]).map(rowToSession);
  }

  getSession(id: string): StoredSession | undefined {
    const r = this.stmt('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return r ? rowToSession(r) : undefined;
  }

  upsertSession(s: StoredSession): void {
    this.stmt(
        `INSERT INTO sessions (id, project_id, folder_id, cwd, agent, title, color, status, pid, resume_id,
           created_at, updated_at, exit_code, x, y, w, h, cols, rows, command, args, role, sort_order, prev_resume_ids, model_pref, mode)
         VALUES (@id, @project_id, @folder_id, @cwd, @agent, @title, @color, @status, @pid, @resume_id,
           @created_at, @updated_at, @exit_code, @x, @y, @w, @h, @cols, @rows, @command, @args, @role, @sort_order, @prev_resume_ids, @model_pref, @mode)
         ON CONFLICT(id) DO UPDATE SET
           project_id=excluded.project_id, folder_id=excluded.folder_id, cwd=excluded.cwd, agent=excluded.agent,
           title=excluded.title, color=excluded.color, status=excluded.status, pid=excluded.pid,
           resume_id=excluded.resume_id, updated_at=excluded.updated_at, exit_code=excluded.exit_code,
           x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h, cols=excluded.cols, rows=excluded.rows,
           command=excluded.command, args=excluded.args, role=excluded.role, sort_order=excluded.sort_order,
           prev_resume_ids=excluded.prev_resume_ids, model_pref=excluded.model_pref, mode=excluded.mode`
      )
      .run({
        id: s.id,
        project_id: s.projectId,
        folder_id: s.folderId,
        cwd: s.cwd,
        agent: s.agent,
        title: s.title,
        color: s.color ?? null,
        status: s.status,
        pid: s.pid ?? null,
        resume_id: s.resumeId ?? null,
        prev_resume_ids: s.prevResumeIds?.length ? JSON.stringify(s.prevResumeIds.slice(-10)) : null,
        model_pref: s.modelPref ?? null,
        mode: s.mode ?? null,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        exit_code: s.exitCode ?? null,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        cols: s.cols,
        rows: s.rows,
        command: s.command ?? null,
        args: s.args ? JSON.stringify(s.args) : null,
        role: s.role,
        sort_order: s.order ?? null
      });
  }

  removeSession(id: string): void {
    this.stmt('DELETE FROM sessions WHERE id = ?').run(id);
    // its notifications go; the team traffic stays (orders and reports it was part of keep their threads)
    this.stmt("DELETE FROM inbox WHERE session_id = ? AND kind NOT IN ('directive', 'report')").run(id);
  }

  /** A deleted project's records: all inbox rows of these sessions, and the done / task marks on them. */
  purgeRecords(sessionIds: string[]): void {
    const del = this.db.transaction((ids: string[]) => {
      for (const id of ids) this.stmt('DELETE FROM inbox WHERE session_id = ? OR from_id = ?').run(id, id);
      this.stmt('DELETE FROM order_done WHERE id NOT IN (SELECT id FROM inbox)').run();
      this.stmt('DELETE FROM order_task WHERE id NOT IN (SELECT id FROM inbox)').run();
    });
    del(sessionIds);
  }

  /* ---------- inbox ---------- */

  /** The latest team traffic (orders, directives, reports — the threads) and the latest notifications, newest first. */
  listInbox(team = 1500, notes = 300): InboxItem[] {
    const rows = [
      ...(this.stmt("SELECT * FROM inbox WHERE kind IN ('directive', 'report') ORDER BY created_at DESC LIMIT ?").all(team) as InboxRow[]),
      ...(this.stmt("SELECT * FROM inbox WHERE kind NOT IN ('directive', 'report') ORDER BY created_at DESC LIMIT ?").all(notes) as InboxRow[])
    ];
    return rows.sort((a, b) => b.created_at - a.created_at).map(rowToInbox);
  }

  lastInboxForSession(sessionId: string): InboxItem | undefined {
    const r = this.stmt('SELECT * FROM inbox WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(sessionId) as InboxRow | undefined;
    return r ? rowToInbox(r) : undefined;
  }

  /** createdAt: keep the original time (records from an opened project file) */
  addInbox(sessionId: string, kind: InboxItem['kind'], text: string, read = false, fromId?: string, createdAt = Date.now(), taskId?: string): InboxItem {
    const item: InboxItem = { id: randomUUID(), sessionId, kind, text, createdAt, read, ...(fromId ? { fromId } : {}), ...(taskId ? { taskId } : {}) };
    this.stmt('INSERT INTO inbox (id, session_id, kind, text, created_at, read, from_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.sessionId, item.kind, item.text, item.createdAt, read ? 1 : 0, fromId ?? null, taskId ?? null);
    // keep the table bounded (checked every 50 inserts: a sorted delete on each insert is wasted work)
    if (++this.inboxInserts % 50 === 0) {
      // notifications: the latest 2000; team traffic (the order threads): the latest 20000
      this.stmt("DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE kind NOT IN ('directive', 'report') ORDER BY created_at DESC LIMIT -1 OFFSET 2000)").run();
      this.stmt("DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE kind IN ('directive', 'report') ORDER BY created_at DESC LIMIT -1 OFFSET 20000)").run();
    }
    return item;
  }

  markInboxRead(id: string): void {
    this.stmt('UPDATE inbox SET read = 1 WHERE id = ?').run(id);
  }
}

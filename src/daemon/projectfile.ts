/**
 * Project files (.agento): one project with its parts saved to a file, and opened again — as a backup, to move it to
 * another PC, or as a template.
 *
 * Saved: the project / part tree, folders, every session's role, agent, title and Ground layout, the routines and the
 * team log (orders and reports). Not saved: the folders' files (they stay where they are) and the terminal output.
 * Opened sessions are not started — a session wakes when it gets work, so opening costs no tokens. A Claude player
 * keeps its conversation (resume id) when its folder exists on this PC; head coaches and coaches start fresh, because
 * their working folders are new. Routines come back paused.
 */
import fs from 'node:fs';
import type { AgentKind, InboxItem, Project, SessionRole } from '@shared/protocol';
import type { Store, StoredSession } from './store';
import type { SessionManager } from './sessions';
import type { Team } from './team';
import type { Routines } from './routines';

const FORMAT = 'agento-project';
const VERSION = 1;

interface FolderOut {
  path: string;
  name: string;
  autoTrust?: boolean;
}

interface SessionOut {
  /** id in the file, for routines and the log */
  key: string;
  /** part key, or null for the project itself */
  part: string | null;
  role: SessionRole;
  agent: AgentKind;
  title: string;
  color?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** a player's folder (absent for a dedicated coach / head coach) */
  folderPath?: string;
  resumeId?: string;
  command?: string;
  args?: string[];
}

interface RoutineOut {
  name: string;
  target: { kind: 'project'; part: string | null } | { kind: 'session'; session: string };
  text: string;
  everyMinutes?: number;
  dailyAt?: string;
}

interface LogOut {
  session: string;
  from: string | null;
  kind: InboxItem['kind'];
  text: string;
  createdAt: number;
}

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  project: { name: string; folders: FolderOut[] };
  parts: { key: string; name: string; folders: FolderOut[] }[];
  sessions: SessionOut[];
  routines: RoutineOut[];
  log: LogOut[];
}

export interface ProjectFileDeps {
  store: Store;
  sessions: SessionManager;
  team: Team;
  routines: Routines;
}

const folders = (p: Project): FolderOut[] => p.folders.map((f) => ({ path: f.path, name: f.name, ...(f.autoTrust ? { autoTrust: true } : {}) }));

export function exportProject(d: ProjectFileDeps, projectId: string): { name: string; file: ProjectFile } {
  const projects = d.store.listProjects();
  const top = projects.find((p) => p.id === projectId && !p.parentId);
  if (!top) throw new Error('Choose a project (not a part) to save');
  const parts = projects.filter((p) => p.parentId === top.id);
  const ids = new Set([top.id, ...parts.map((p) => p.id)]);
  const members = d.sessions
    .list()
    .map((s) => d.sessions.get(s.id))
    .filter((s): s is StoredSession => s !== undefined && ids.has(s.projectId));
  const memberIds = new Set(members.map((s) => s.id));
  const folderPath = (s: StoredSession): string | undefined =>
    s.folderId ? projects.find((p) => p.id === s.projectId)?.folders.find((f) => f.id === s.folderId)?.path : undefined;

  const sessions: SessionOut[] = members.map((s) => {
    const fp = folderPath(s);
    return {
      key: s.id,
      part: s.projectId === top.id ? null : s.projectId,
      role: s.role,
      agent: s.agent,
      title: s.title,
      ...(s.color ? { color: s.color } : {}),
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      ...(fp ? { folderPath: fp } : {}),
      ...(s.resumeId ? { resumeId: s.resumeId } : {}),
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {})
    };
  });

  const routines: RoutineOut[] = [];
  for (const r of d.routines.list()) {
    let target: RoutineOut['target'] | undefined;
    if (r.target.kind === 'project' && ids.has(r.target.projectId)) target = { kind: 'project', part: r.target.projectId === top.id ? null : r.target.projectId };
    if (r.target.kind === 'session' && memberIds.has(r.target.sessionId)) target = { kind: 'session', session: r.target.sessionId };
    // a routine for several projects: saved here as this project's own (the other projects keep theirs)
    if (r.target.kind === 'projects' && r.target.projectIds.includes(top.id)) target = { kind: 'project', part: null };
    if (!target) continue;
    routines.push({ name: r.name, target, text: r.text, ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes ?? 60 }) });
  }

  const log: LogOut[] = d.store
    .listInbox(2000)
    .filter((i) => memberIds.has(i.sessionId) && (i.kind === 'directive' || i.kind === 'report'))
    .map((i) => ({
      session: i.sessionId,
      from: i.fromId === 'user' ? 'user' : i.fromId && memberIds.has(i.fromId) ? i.fromId : null,
      kind: i.kind,
      text: i.text,
      createdAt: i.createdAt
    }));

  return {
    name: top.name,
    file: {
      format: FORMAT,
      version: VERSION,
      exportedAt: Date.now(),
      project: { name: top.name, folders: folders(top) },
      parts: parts.map((p) => ({ key: p.id, name: p.name, folders: folders(p) })),
      sessions,
      routines,
      log
    }
  };
}

function parse(data: string): ProjectFile {
  let f: ProjectFile;
  try {
    f = JSON.parse(data) as ProjectFile;
  } catch {
    throw new Error('This is not an AgentO project file');
  }
  if (f?.format !== FORMAT || !f.project?.name) throw new Error('This is not an AgentO project file');
  if (f.version > VERSION) throw new Error('This project file was saved by a newer AgentO');
  return { ...f, parts: f.parts ?? [], sessions: f.sessions ?? [], routines: f.routines ?? [], log: f.log ?? [] };
}

/** Opens a project file as a new project; returns its name and how many folders are missing on this PC. */
export function importProject(d: ProjectFileDeps, data: string): { project: Project; missing: number } {
  const f = parse(data);
  const taken = new Set(d.store.listProjects().filter((p) => !p.parentId).map((p) => p.name));
  let name = f.project.name;
  for (let n = 2; taken.has(name); n++) name = `${f.project.name} (${n})`;

  let missing = 0;
  const addFolders = (projectId: string, list: FolderOut[]): void => {
    for (const fo of list) {
      if (!fs.existsSync(fo.path)) missing++;
      d.store.addFolder(projectId, fo.path, fo.name, fo.autoTrust === true);
    }
  };
  const top = d.store.createProject(name);
  addFolders(top.id, f.project.folders ?? []);
  const partId = new Map<string, string>();
  for (const p of f.parts) {
    const created = d.store.createProject(p.name, top.id);
    partId.set(p.key, created.id);
    addFolders(created.id, p.folders ?? []);
  }
  const projectFor = (part: string | null): string => (part ? partId.get(part) ?? top.id : top.id);
  const projects = (): Project[] => d.store.listProjects();

  const sessionId = new Map<string, string>();
  for (const s of f.sessions) {
    const projectId = projectFor(s.part);
    const project = projects().find((p) => p.id === projectId)!;
    const folder = s.folderPath ? project.folders.find((fo) => fo.path === s.folderPath) : undefined;
    let cwd: string;
    if (s.role === 'head') cwd = d.team.headDir(top.id);
    else if (!folder) cwd = d.team.coachDir(project); // a dedicated coach (or a player whose folder was not saved)
    else cwd = folder.path;
    // a Claude conversation resumes from ~/.claude under the same folder: only a player in its own existing folder
    const keepResume = s.agent === 'claude' && s.role !== 'head' && folder !== undefined && fs.existsSync(folder.path);
    const created = d.sessions.restore({
      projectId,
      folderId: s.role === 'head' || !folder ? '' : folder.id,
      cwd,
      agent: s.agent,
      role: s.role === 'coach' && !folder ? 'coach' : s.role,
      title: s.title,
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {}),
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      ...(s.color ? { color: s.color } : {}),
      ...(keepResume && s.resumeId ? { resumeId: s.resumeId } : {})
    });
    sessionId.set(s.key, created.id);
  }

  for (const r of f.routines) {
    const target =
      r.target.kind === 'project'
        ? { kind: 'project' as const, projectId: projectFor(r.target.part) }
        : sessionId.has(r.target.session)
          ? { kind: 'session' as const, sessionId: sessionId.get(r.target.session)! }
          : undefined;
    if (!target) continue;
    d.routines.save({ name: r.name, target, text: r.text, enabled: false, ...(r.dailyAt ? { dailyAt: r.dailyAt } : { everyMinutes: r.everyMinutes ?? 60 }) });
  }

  for (const l of [...f.log].sort((a, b) => a.createdAt - b.createdAt)) {
    const to = sessionId.get(l.session);
    if (!to) continue;
    const from = l.from === 'user' ? 'user' : l.from ? sessionId.get(l.from) : undefined;
    d.store.addInbox(to, l.kind, l.text, true, from, l.createdAt);
  }
  return { project: projects().find((p) => p.id === top.id)!, missing };
}

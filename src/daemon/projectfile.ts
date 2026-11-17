/**
 * Project files (.agento): one project with its parts saved to a file, and opened again — as a backup, to move it to
 * another PC, or as a template.
 *
 * Saved: the project / part tree, folders, every session's agent, title and Ground layout. Not saved: the folders'
 * files (they stay where they are) and the terminal output. Opened sessions are not started — a session wakes when it
 * gets work, so opening costs no tokens. A Claude session keeps its conversation (resume id) when its folder exists on
 * this PC. Older files may carry roles, routines and a team log: they are read and the extra parts are ignored.
 */
import fs from 'node:fs';
import type { AgentKind, Project } from '@shared/protocol';
import type { Store, StoredSession } from './store';
import type { SessionManager } from './sessions';

const FORMAT = 'agento-project';
const VERSION = 1;

interface FolderOut {
  path: string;
  name: string;
  autoTrust?: boolean;
}

interface SessionOut {
  /** id in the file */
  key: string;
  /** part key, or null for the project itself */
  part: string | null;
  agent: AgentKind;
  title: string;
  color?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** the session's folder (absent when it had none) */
  folderPath?: string;
  resumeId?: string;
  command?: string;
  args?: string[];
  /** only in older files (the team layer it came from no longer exists) */
  role?: string;
}

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  project: { name: string; folders: FolderOut[] };
  parts: { key: string; name: string; folders: FolderOut[] }[];
  sessions: SessionOut[];
}

export interface ProjectFileDeps {
  store: Store;
  sessions: SessionManager;
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
  const folderPath = (s: StoredSession): string | undefined =>
    s.folderId ? projects.find((p) => p.id === s.projectId)?.folders.find((f) => f.id === s.folderId)?.path : undefined;

  const sessions: SessionOut[] = members.map((s) => {
    const fp = folderPath(s);
    return {
      key: s.id,
      part: s.projectId === top.id ? null : s.projectId,
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

  return {
    name: top.name,
    file: {
      format: FORMAT,
      version: VERSION,
      exportedAt: Date.now(),
      project: { name: top.name, folders: folders(top) },
      parts: parts.map((p) => ({ key: p.id, name: p.name, folders: folders(p) })),
      sessions
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
  return { ...f, parts: f.parts ?? [], sessions: f.sessions ?? [] };
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

  for (const s of f.sessions) {
    // a session that worked in a folder of the team layer (an old file's Coach) has no folder to come back to
    if (!s.folderPath) continue;
    const projectId = projectFor(s.part);
    const project = projects().find((p) => p.id === projectId)!;
    const folder = project.folders.find((fo) => fo.path === s.folderPath);
    if (!folder) continue;
    // a Claude conversation resumes from ~/.claude under the same folder
    const keepResume = s.agent === 'claude' && fs.existsSync(folder.path);
    d.sessions.restore({
      projectId,
      folderId: folder.id,
      cwd: folder.path,
      agent: s.agent,
      role: 'player',
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
  }
  return { project: projects().find((p) => p.id === top.id)!, missing };
}

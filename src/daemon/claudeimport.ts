/**
 * Bring Claude Code sessions started elsewhere (VS Code, a terminal) into AgentO: list the transcripts under
 * ~/.claude/projects whose working folder is a project folder (or inside it), and add the picked ones as players that
 * resume that conversation (`claude --resume <id>` in its own folder). They are added stopped and wake when they get
 * work. One conversation should not run in VS Code and AgentO at the same time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeSessionInfo, Session } from '@shared/protocol';
import type { SessionManager } from './sessions';
import type { Store } from './store';
import { claudeProjectDirName } from './agents';
import { findTranscript } from './transcript';

/** Read this much of a transcript's start to find its folder, title and first prompt. */
const HEAD_BYTES = 256 * 1024;
/** Written to this recently: probably still open in VS Code. */
const ACTIVE_MS = 3 * 60 * 1000;

function projectsDir(): string {
  return path.join(process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude'), 'projects');
}

const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const inside = (child: string, parent: string): boolean => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
};

type Json = Record<string, unknown>;

/** Folder, title (summary or first prompt) and first prompt from the start of a transcript. */
function head(file: string): { cwd?: string; title?: string; firstPrompt?: string } {
  const fd = fs.openSync(file, 'r');
  let text: string;
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    text = buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  let cwd: string | undefined;
  let summary: string | undefined;
  let firstPrompt: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j: Json;
    try {
      j = JSON.parse(line) as Json;
    } catch {
      continue; // the cut-off last line
    }
    if (!cwd && typeof j['cwd'] === 'string') cwd = j['cwd'];
    if (!summary && j['type'] === 'summary' && typeof j['summary'] === 'string') summary = j['summary'];
    if (!firstPrompt && j['type'] === 'user' && typeof j['message'] === 'object' && j['message'] !== null) {
      const c = (j['message'] as Json)['content'];
      const t =
        typeof c === 'string' ? c : Array.isArray(c) ? ((c as Json[]).find((e) => e['type'] === 'text')?.['text'] as string | undefined) : undefined;
      // skip command wrappers and tool output the CLI records as user turns
      if (t && !t.startsWith('<') && !t.startsWith('Caveat:')) firstPrompt = t.replace(/\s+/g, ' ').trim();
    }
    if (cwd && summary && firstPrompt) break;
  }
  return { cwd, title: summary ?? firstPrompt, firstPrompt };
}

/** Claude Code sessions whose folder is `folder` or inside it, newest first. */
export function listClaudeSessions(folder: string, sessions: SessionManager): ClaudeSessionInfo[] {
  const root = projectsDir();
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return [];
  }
  // a folder's transcripts live in <encoded path>/, a subfolder's in <encoded path>-<sub>/ (encoding: non-alnum → '-')
  const want = claudeProjectDirName(path.resolve(folder)).toLowerCase();
  const candidates = dirs.filter((d) => d.toLowerCase() === want || d.toLowerCase().startsWith(want + '-'));
  const known = new Map<string, Session>();
  for (const s of sessions.list()) if (s.resumeId) known.set(s.resumeId, s);
  const out: ClaudeSessionInfo[] = [];
  const now = Date.now();
  for (const d of candidates) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(root, d, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.size < 200) continue; // started and left without a message
      const info = head(file);
      if (!info.cwd || !inside(info.cwd, folder)) continue; // an encoded name can match an unrelated folder
      if (!info.title) continue; // opened and left without a prompt: nothing to continue
      const id = path.basename(f, '.jsonl');
      const mine = known.get(id);
      out.push({
        id,
        cwd: info.cwd,
        title: (info.title ?? '(no prompt)').slice(0, 120),
        ...(info.firstPrompt ? { firstPrompt: info.firstPrompt.slice(0, 300) } : {}),
        updatedAt: st.mtimeMs,
        size: st.size,
        active: now - st.mtimeMs < ACTIVE_MS,
        ...(mine ? { inAgento: mine.title } : {})
      });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A transcript anywhere under ~/.claude/projects, by session id. */
function outside(id: string, sessions: SessionManager): ClaudeSessionInfo | undefined {
  const file = findTranscript('', id);
  if (!file) return undefined;
  const info = head(file);
  if (!info.cwd) return undefined;
  const st = fs.statSync(file);
  const mine = sessions.list().find((s) => s.resumeId === id);
  return {
    id,
    cwd: info.cwd,
    title: (info.title ?? '(no prompt)').slice(0, 120),
    updatedAt: st.mtimeMs,
    size: st.size,
    active: Date.now() - st.mtimeMs < ACTIVE_MS,
    ...(mine ? { inAgento: mine.title } : {})
  };
}

/** Adds the picked sessions as stopped players of the project (part) that resume their conversation. */
export function importClaudeSessions(
  store: Store,
  sessions: SessionManager,
  opts: { projectId: string; folderId: string; ids: string[]; titles?: Record<string, string> }
): Session[] {
  const project = store.listProjects().find((p) => p.id === opts.projectId);
  const folder = project?.folders.find((f) => f.id === opts.folderId);
  if (!project || !folder) throw new Error('Pick a project folder to bring the sessions into');
  const list = listClaudeSessions(folder.path, sessions);
  const added: Session[] = [];
  for (const id of opts.ids) {
    // a session from another folder (picked by id): it keeps running in its own folder, where its conversation is
    const info = list.find((x) => x.id === id) ?? outside(id, sessions);
    if (!info) throw new Error(`No Claude Code session ${id}`);
    if (info.inAgento) continue; // already here
    const title = opts.titles?.[id]?.trim() || info.title.slice(0, 40);
    added.push(
      sessions.restore({
        projectId: project.id,
        folderId: folder.id,
        // resume in the folder the conversation ran in: Claude Code finds it by that folder
        cwd: fs.existsSync(info.cwd) ? info.cwd : folder.path,
        agent: 'claude',
        role: 'player',
        title,
        resumeId: id
      })
    );
  }
  return added;
}

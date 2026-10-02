/**
 * Filesystem helpers exposed over the protocol: fs.list, fs.read, fs.changed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import type { FsEntry } from '@shared/protocol';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const READ_CAP = 1024 * 1024; // 1 MB

/* ---------- file name search (Quick Open) ---------- */

/** folders never indexed: dependencies, VCS data, build output */
const INDEX_SKIP = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target', 'bin', 'obj', '.next', '.nuxt', '.gradle', '.idea', '.vs', '__pycache__', '.venv', 'venv', 'coverage', '.cache']);
const INDEX_MAX = 150_000;
const INDEX_TTL_MS = 60_000;
const index = new Map<string, { at: number; files: Promise<string[]> }>();

/** Every file under a folder (relative paths, capped), cached for a minute. */
function filesOf(root: string): Promise<string[]> {
  const hit = index.get(root);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.files;
  const files = (async () => {
    const out: string[] = [];
    const stack = [''];
    while (stack.length && out.length < INDEX_MAX) {
      const rel = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const r = rel ? path.join(rel, e.name) : e.name;
        if (e.isDirectory()) {
          if (!INDEX_SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(r);
        } else if (e.isFile()) out.push(r);
      }
    }
    return out;
  })();
  index.set(root, { at: Date.now(), files });
  return files;
}

/**
 * Files under the roots whose path contains every word of the query (case-insensitive); file-name matches first,
 * shorter paths first. Nested roots are searched once.
 */
export async function searchFiles(roots: string[], query: string, limit = 50): Promise<{ path: string; root: string }[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const norm = (p: string): string => path.resolve(p).toLowerCase();
  const unique = [...new Set(roots.map((r) => path.resolve(r)))].filter(
    (r, _, all) => !all.some((o) => o !== r && norm(r).startsWith(norm(o) + path.sep))
  );
  const hits: { path: string; root: string; score: number }[] = [];
  for (const root of unique) {
    for (const rel of await filesOf(root)) {
      const low = rel.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const name = path.basename(low);
      const score = (words.every((w) => name.includes(w)) ? 1000 : 0) + (name.startsWith(words[0]!) ? 200 : 0) - rel.length;
      hits.push({ path: path.join(root, rel), root, score });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ path: p, root }) => ({ path: p, root }));
}

export async function listDir(dir: string): Promise<FsEntry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (SKIP_DIRS.has(d.name)) continue;
    const full = path.join(dir, d.name);
    let isDir = d.isDirectory();
    let size: number | undefined;
    if (d.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        isDir = st.isDirectory();
        if (!isDir) size = st.size;
      } catch {
        /* dangling symlink */
      }
    } else if (!isDir) {
      try {
        size = (await fs.stat(full)).size;
      } catch {
        /* ignore */
      }
    }
    const e: FsEntry = { name: d.name, path: full, isDir };
    if (size !== undefined) e.size = size;
    entries.push(e);
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  return entries;
}

export async function readFileCapped(file: string): Promise<{ content: string; truncated: boolean }> {
  const handle = await fs.open(file, 'r');
  try {
    const st = await handle.stat();
    const truncated = st.size > READ_CAP;
    const len = Math.min(st.size, READ_CAP);
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const { bytesRead } = await handle.read(buf, off, len - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return { content: buf.subarray(0, off).toString('utf8'), truncated };
  } finally {
    await handle.close();
  }
}

function mapGitStatus(xy: string): FsEntry['gitStatus'] {
  const x = xy[0] ?? ' ';
  const y = xy[1] ?? ' ';
  if (x === '?' || y === '?') return '?';
  if (x === 'R' || y === 'R') return 'R';
  if (x === 'A' || y === 'A') return 'A';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'M' || y === 'M' || x === 'U' || y === 'U' || x === 'T' || y === 'T') return 'M';
  return 'M';
}

/** `git status --porcelain` mapped to FsEntry[]; empty if not a repo or git is missing. */
export function gitChanged(cwd: string): Promise<FsEntry[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 },
      async (err, stdout) => {
        if (err) return resolve([]);
        const entries: FsEntry[] = [];
        for (const rawLine of stdout.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (line.length < 4) continue;
          const xy = line.slice(0, 2);
          let rel = line.slice(3);
          // renames: "R  old -> new"
          const arrow = rel.indexOf(' -> ');
          if (arrow >= 0) rel = rel.slice(arrow + 4);
          if (rel.startsWith('"') && rel.endsWith('"')) {
            try {
              rel = JSON.parse(rel) as string;
            } catch {
              rel = rel.slice(1, -1);
            }
          }
          const full = path.join(cwd, rel);
          let isDir = false;
          let size: number | undefined;
          try {
            const st = await fs.stat(full);
            isDir = st.isDirectory();
            if (!isDir) size = st.size;
          } catch {
            /* deleted file */
          }
          const e: FsEntry = { name: rel, path: full, isDir, gitStatus: mapGitStatus(xy) };
          if (size !== undefined) e.size = size;
          entries.push(e);
        }
        resolve(entries);
      }
    );
  });
}

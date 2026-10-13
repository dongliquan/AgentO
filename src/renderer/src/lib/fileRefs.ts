import { create } from 'zustand';
import { useStore } from '@/store';
import { send } from '@/client';

import { isFileRef } from './fileRefPattern';

export { isFileRef };

/** "src/a.ts:12-20" → "src/a.ts" */
const stripLine = (t: string): string => t.trim().replace(/:\d+(?:[-~]\d+)?$/, '');
const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const isAbs = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

/**
 * The file a reference means: an absolute path as it is; otherwise the open projects' files with that name (Quick
 * Open's search), the one whose path ends with the reference, preferring the session's folder.
 */
export async function resolveFileRef(ref: string, cwd?: string): Promise<string | null> {
  const want = stripLine(ref);
  if (isAbs(want)) return want;
  if (cwd && /[\\/]/.test(want)) {
    // a relative path inside the session's folder
    const joined = `${cwd.replace(/[\\/]+$/, '')}\\${want.replace(/\//g, '\\')}`;
    return joined;
  }
  const name = want.split(/[\\/]/).pop()!;
  const tag = `ref:${Date.now()}:${Math.random()}`;
  const items = await new Promise<{ path: string }[]>((resolve) => {
    const stop = useStore.subscribe((st) => {
      if (st.fileSearch?.ref !== tag) return;
      stop();
      resolve(st.fileSearch.items);
    });
    send({ type: 'fs.search', ref: tag, query: name });
    setTimeout(() => {
      stop();
      resolve([]);
    }, 30000); // the first search walks every project folder: seconds on big ones
  });
  const tail = norm(want);
  const hits = items.map((i) => i.path).filter((p) => norm(p).endsWith(`\\${tail}`) || norm(p) === tail);
  if (!hits.length) return null;
  const inCwd = cwd ? hits.find((p) => norm(p).startsWith(norm(cwd) + '\\')) : undefined;
  return inCwd ?? hits[0]!;
}

/** The little menu a clicked file reference opens (Open · Show in sidebar · Copy path). */
export const useFileRefMenu = create<{ at: { x: number; y: number; ref: string; cwd?: string } | null; show: (at: { x: number; y: number; ref: string; cwd?: string }) => void; hide: () => void }>((set) => ({
  at: null,
  show: (at) => set({ at }),
  hide: () => set({ at: null })
}));

/** Show a file in the sidebar's tree: its project, folder and subfolders opened, the row selected and scrolled to. */
export const useReveal = create<{ path: string | null; nonce: number; reveal: (path: string) => void }>((set) => ({
  path: null,
  nonce: 0,
  reveal: (path) => {
    const st = useStore.getState();
    if (!st.sidebarOpen) st.toggleSidebar();
    if (st.treeFilter !== 'all') st.setTreeFilter('all');
    set({ path, nonce: Date.now() });
  }
}));

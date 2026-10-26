import { create } from 'zustand';
import { useStore } from '@/store';
import { useDock } from '@/lib/dock';
import { IS_PANELS, relay } from '@/lib/role';
import { send } from '@/client';
import { normPath } from './format';

/** "src/a.ts:12-20" → "src/a.ts" */
const stripLine = (t: string): string => t.trim().replace(/:\d+(?:[-~]\d+)?$/, '');
const isAbs = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');

/**
 * The file a reference means: an absolute path as it is; otherwise the open projects' files with that name (Quick
 * Open's search), the one whose path ends with the reference, preferring the session's folder. A shortened path
 * ("module-review/.../domain/Repo.java", as Claude Code prints them) matches on its tail, among paths under its head.
 * A relative path nothing matches is taken as inside the session's folder.
 */
export async function resolveFileRef(ref: string, cwd?: string): Promise<string | null> {
  const want = stripLine(ref);
  if (isAbs(want)) return want;
  const parts = want.split(/(?:^|[\\/])(?:\.\.\.|…)(?:[\\/]|$)/);
  const head = parts.length > 1 ? normPath(parts[0]!) : '';
  const tail = parts[parts.length - 1]!;
  const name = tail.split(/[\\/]/).pop()!;
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
  const nt = normPath(tail);
  let hits = items.map((i) => i.path).filter((p) => normPath(p).endsWith(`\\${nt}`) || normPath(p) === nt);
  if (head) {
    const under = hits.filter((p) => normPath(p).includes(`\\${head}\\`) || normPath(p).startsWith(`${head}\\`));
    if (under.length) hits = under;
  }
  if (!hits.length) return cwd && !head && /[\\/]/.test(want) ? `${cwd.replace(/[\\/]+$/, '')}\\${want.replace(/\//g, '\\')}` : null;
  const inCwd = cwd ? hits.find((p) => normPath(p).startsWith(normPath(cwd) + '\\')) : undefined;
  return inCwd ?? hits[0]!;
}

/** The little menu a right-clicked file reference opens (Open · Open in ReadO · Show in Files · Copy path). */
export const useFileRefMenu = create<{ at: { x: number; y: number; ref: string; cwd?: string } | null; show: (at: { x: number; y: number; ref: string; cwd?: string }) => void; hide: () => void }>((set) => ({
  at: null,
  show: (at) => set({ at }),
  hide: () => set({ at: null })
}));

/** Show a file in the Files tab: its project's folder and subfolders opened, the row selected and scrolled to. */
export const useReveal = create<{ path: string | null; nonce: number; reveal: (path: string) => void }>((set) => ({
  path: null,
  nonce: 0,
  reveal: (path) => {
    const st = useStore.getState();
    // the panels are in their own window: the Files tab is there
    if (!IS_PANELS && st.panelsDetached) {
      relay({ kind: 'revealFile', path });
      return;
    }
    const dock = useDock.getState();
    if (dock.docked.includes('files')) dock.setShown('files');
    else st.setRightTab('files');
    set({ path, nonce: Date.now() });
  }
}));

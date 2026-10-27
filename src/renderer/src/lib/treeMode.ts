import { create } from 'zustand';
import type { Session } from '@shared/protocol';

/**
 * The project tree shows the sessions that matter now (Active) or every session (All). Active: running a turn,
 * starting, failed, asking something (a prompt, a permission, a question to the manager), a coordinator with work
 * handed out, or the selected one. The rest fold to one "N idle" row per project. Kept in this browser.
 */
export type TreeMode = 'active' | 'all';
const KEY = 'asm.treeMode';

function load(): TreeMode {
  try {
    return localStorage.getItem(KEY) === 'all' ? 'all' : 'active';
  } catch {
    return 'active';
  }
}

export const useTreeMode = create<{ mode: TreeMode; setMode: (m: TreeMode) => void }>((set) => ({
  mode: load(),
  setMode: (mode) => {
    set({ mode });
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* not kept */
    }
  }
}));

export function isActiveSession(s: Session, ctx: { selectedId: string | null; needs: ReadonlySet<string>; delegating: ReadonlyMap<string, unknown[]> }): boolean {
  if (s.status === 'working' || s.status === 'starting' || s.status === 'error') return true;
  if (s.attention || s.permission || s.limit) return true;
  if (ctx.needs.has(s.id) || ctx.selectedId === s.id) return true;
  return (ctx.delegating.get(s.id)?.length ?? 0) > 0;
}

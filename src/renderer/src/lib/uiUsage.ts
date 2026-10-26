import { useStore } from '@/store';
import { IS_PANELS } from '@/lib/role';

/**
 * How often each view and right-panel tab is opened — counted in this browser only (localStorage), never sent
 * anywhere. For deciding which tabs to keep (Help › UI Usage shows the counts). Each window counts its own.
 */
const KEY = 'asm.uiUsage';
interface Usage {
  since: number;
  counts: Record<string, number>;
}

function load(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Usage | null;
    if (u && typeof u.since === 'number' && u.counts) return u;
  } catch {
    /* fresh */
  }
  return { since: Date.now(), counts: {} };
}

export function countUse(what: string): void {
  try {
    const u = load();
    const key = `${IS_PANELS ? 'panels' : 'main'} · ${what}`;
    u.counts[key] = (u.counts[key] ?? 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    /* not counted */
  }
}

export function readUsage(): Usage {
  return load();
}

export function resetUsage(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ since: Date.now(), counts: {} }));
  } catch {
    /* ignore */
  }
}

/** Count tab and view changes (once per window). */
export function initUiUsage(): void {
  useStore.subscribe((next, prev) => {
    if (next.rightTab !== prev.rightTab) countUse(`tab ${next.rightTab}`);
    if (next.viewMode !== prev.viewMode || (next.centerView !== prev.centerView && next.centerView === 'sessions')) countUse(`view ${next.viewMode}`);
    if (next.focusMode && !prev.focusMode) countUse('focus mode');
  });
}

import { create } from 'zustand';
import { useStore, type RightTab } from '@/store';
import { IS_PANELS } from '@/lib/role';

/**
 * Right-panel tabs moved to the second panel beside it (⇥ on the main panel's tab strip, ⇤ on the second panel's) —
 * per window: the main window and the panels window each remember their own.
 */
export const TAB_ORDER: RightTab[] = ['orders', 'inbox', 'detail', 'files', 'log', 'web'];

const KEY = `asm.docked.${IS_PANELS ? 'panels' : 'main'}`;

function load(): RightTab[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (JSON.parse(raw) as RightTab[]).filter((t) => TAB_ORDER.includes(t));
    // the earlier "Web beside the panel" switch (main window only)
    if (!IS_PANELS && localStorage.getItem('asm.webDocked') === '1') return ['web'];
  } catch {
    /* storage unavailable */
  }
  return [];
}

function save(list: RightTab[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.removeItem('asm.webDocked');
  } catch {
    /* storage unavailable */
  }
}

interface DockState {
  /** the tabs in the second panel */
  docked: RightTab[];
  /** the one the second panel shows */
  shown: RightTab | null;
  setShown(tab: RightTab): void;
  dock(tab: RightTab): void;
  undock(tab: RightTab): void;
}

export const useDock = create<DockState>((set, get) => ({
  docked: load(),
  shown: null,
  setShown: (tab) => set({ shown: tab }),
  dock: (tab) => {
    if (get().docked.includes(tab)) return;
    // one tab always stays in the panel
    if (TAB_ORDER.filter((t) => !get().docked.includes(t)).length <= 1) return;
    const docked = TAB_ORDER.filter((t) => t === tab || get().docked.includes(t));
    save(docked);
    set({ docked, shown: tab });
  },
  undock: (tab) => {
    const docked = get().docked.filter((t) => t !== tab);
    save(docked);
    set({ docked });
    // it is shown in the main panel again
    useStore.getState().setRightTab(tab);
  }
}));

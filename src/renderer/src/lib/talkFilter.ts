import { create } from 'zustand';

const KEY = 'asm.draft.me.project';

function load(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string) : '';
  } catch {
    return '';
  }
}

/**
 * The project filter shared by the Manager tab (and its order box), the Inbox and the Logs: picking a project in one
 * narrows the others too, in every window. '' = all projects.
 */
export const useTalkProject = create<{ project: string; setProject: (id: string) => void }>((set) => ({
  project: load(),
  setProject: (id) => {
    set({ project: id });
    try {
      localStorage.setItem(KEY, JSON.stringify(id));
    } catch {
      /* not kept */
    }
  }
}));

// the other window (panels / main) picked a project: follow it
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const id = load();
    if (useTalkProject.getState().project !== id) useTalkProject.setState({ project: id });
  });
}

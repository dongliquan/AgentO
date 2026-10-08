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
 * The Manager tab's project filter (the conversation above the order box). Shared, so picking a project in the order
 * box below narrows the conversation to it too. '' = all projects.
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

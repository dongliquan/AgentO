import { create } from 'zustand';

/** Commit subjects the daemon looked up ("feat: top bar tidy-up"), by hash — the Timeline names features with them. */
export const useGitSubjects = create<{ subjects: Record<string, string>; asked: Set<string>; add: (s: Record<string, string>) => void }>((set, get) => ({
  subjects: {},
  asked: new Set(),
  add: (s) => {
    if (Object.keys(s).some((h) => get().subjects[h] !== s[h])) set({ subjects: { ...get().subjects, ...s } });
  }
}));

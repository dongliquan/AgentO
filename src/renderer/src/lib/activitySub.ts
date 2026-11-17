import { create } from 'zustand';

/** The Activity tab shows the alerts (Inbox) or the team's log (Logs): which one, remembered per user. */
export type ActivitySub = 'alerts' | 'log';
const KEY = 'asm.activity.sub';

const read = (): ActivitySub => {
  try {
    return localStorage.getItem(KEY) === 'log' ? 'log' : 'alerts';
  } catch {
    return 'alerts';
  }
};

export const useActivitySub = create<{ sub: ActivitySub; set: (v: ActivitySub) => void }>((set) => ({
  sub: read(),
  set: (v) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* not kept */
    }
    set({ sub: v });
  }
}));

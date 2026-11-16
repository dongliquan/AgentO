import { create } from 'zustand';

/**
 * "While you were away": the time of the manager's last activity in the app (a click, a key, the window in front).
 * After a pause of AWAY_MIN or more, the next activity opens a summary of what happened since — kept in this store, and
 * on app start also remembered across restarts (localStorage), so a restart shows what went on while AgentO was shut.
 */
export const AWAY_MIN = 30;
const KEY = 'asm.lastActive';
const AWAY_KEY = 'asm.away.since';

interface AwayState {
  /** the time the manager was last around before the pause; null: no summary */
  since: number | null;
  /** it was found when the app started (not while it was open): the Today view opens by itself once */
  atStart: boolean;
  dismiss: () => void;
}

const read = (k: string): number => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch {
    return 0;
  }
};
const write = (k: string, v: number | null): void => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, String(v));
  } catch {
    /* not kept */
  }
};

export const useAway = create<AwayState>(() => ({
  since: null,
  atStart: false,
  dismiss: () => {
    write(AWAY_KEY, null);
    useAway.setState({ since: null, atStart: false });
  }
}));

let lastActive = Date.now();
let lastWrite = 0;
let started = false;

/** Call once per window (the main one): finds a pause that ended now and starts watching activity. */
export function startAwayWatch(): void {
  if (started) return;
  started = true;
  const now = Date.now();
  const prev = read(KEY);
  const pending = read(AWAY_KEY); // a summary the manager has not dismissed yet
  if (prev && now - prev >= AWAY_MIN * 60_000) {
    write(AWAY_KEY, prev);
    useAway.setState({ since: prev, atStart: true });
  } else if (pending) {
    useAway.setState({ since: pending, atStart: false });
  }
  lastActive = now;
  write(KEY, now);
  const touch = (): void => {
    const t = Date.now();
    if (t - lastActive >= AWAY_MIN * 60_000 && useAway.getState().since === null) {
      write(AWAY_KEY, lastActive);
      useAway.setState({ since: lastActive, atStart: false });
    }
    lastActive = t;
    // not on every mouse move
    if (t - lastWrite > 15_000) {
      lastWrite = t;
      write(KEY, t);
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'focus']) window.addEventListener(ev, touch, { passive: true, capture: true });
  window.addEventListener('beforeunload', () => write(KEY, Date.now()));
}

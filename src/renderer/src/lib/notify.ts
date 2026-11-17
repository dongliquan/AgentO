import { create } from 'zustand';
import type { Session } from '@shared/protocol';
import { useStore } from '@/store';
import { runCommand, selectAndReveal } from '@/commands';

/**
 * What raises a notification: a session's status change (every session, or none), and a request the daemon refused.
 * Per viewer, in localStorage. The window in the background gets an OS notification; a focused window shows a toast.
 */
export interface NotifyPrefs {
  sessions: 'all' | 'off';
}

const KEY = 'asm.notify';
const DEFAULTS: NotifyPrefs = { sessions: 'all' };

function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as { sessions?: string };
      return { sessions: p.sessions === 'off' ? 'off' : 'all' };
    }
  } catch {
    /* defaults */
  }
  return DEFAULTS;
}

export const useNotifyPrefs = create<NotifyPrefs & { set: (p: Partial<NotifyPrefs>) => void }>((set, get) => ({
  ...loadPrefs(),
  set: (p) => {
    set(p);
    try {
      localStorage.setItem(KEY, JSON.stringify({ sessions: get().sessions }));
    } catch {
      /* not kept */
    }
  }
}));

export interface Toast {
  id: number;
  title: string;
  body: string;
  /** a palette/menu command id run on click */
  command?: string;
  sessionId?: string;
}

let toastSeq = 0;
export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismiss(id), 8000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}));

/** Opens what a notification is about: the session on the Ground, and the command's view (the Manager tab). */
export function openNotification(t: { command?: string; sessionId?: string }): void {
  if (t.sessionId && useStore.getState().sessions.has(t.sessionId)) selectAndReveal(t.sessionId);
  if (t.command) runCommand(t.command);
}

/** Whether a session's status change should raise an OS notification under the current settings. */
export function wantsStatusNotification(s: Session): boolean {
  const pref = useNotifyPrefs.getState().sessions;
  if (pref === 'off') return false;
  return s.id !== '';
}

/** Main window only: a request the daemon refused (e.g. "busy — fresh start it when it is idle") is said out loud. */
export function initNotifications(): void {
  useStore.subscribe((next, prev) => {
    if (next.lastError && next.lastError !== prev.lastError) {
      useToasts.getState().push({ title: 'Could not do that', body: next.lastError });
      // cleared, so the same refusal shows again next time
      setTimeout(() => useStore.setState({ lastError: null }), 0);
    }
  });
}

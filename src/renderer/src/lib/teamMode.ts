import { create } from 'zustand';
import type { Session } from '@shared/protocol';

/**
 * Team mode: the Head Coach / Coach layers and the screens built around them (Manager, Inbox and Logs tabs, Timeline).
 * Off by default — AgentO then looks like plain sessions side by side; the team machinery stays in the daemon and a
 * project that has a Coach keeps working. Kept per user in localStorage and followed by the other window.
 */
const KEY = 'asm.teamMode';

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

interface TeamModeState {
  team: boolean;
  set: (v: boolean) => void;
}

export const useTeamMode = create<TeamModeState>((set) => ({
  team: read(),
  set: (v) => {
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* not kept */
    }
    set({ team: v });
  }
}));

window.addEventListener('storage', (e) => {
  if (e.key === KEY) useTeamMode.setState({ team: e.newValue === '1' });
});

/** Right-panel tabs that belong to team mode: the manager's orders, the inbox of team reports, the team log. */
export const TEAM_TABS: string[] = ['orders', 'inbox', 'log'];

export const isTeamMode = (): boolean => useTeamMode.getState().team;

/** Coordinators (Head Coach, Coach, part Coach) are part of team mode: without it they are not shown. */
export const teamOnly = (s: Pick<Session, 'role'>): boolean => s.role === 'head' || s.role === 'coach';
export const hiddenInSimple = (s: Pick<Session, 'role'>): boolean => teamOnly(s) && !isTeamMode();

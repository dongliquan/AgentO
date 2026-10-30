import type { AgentConnection } from '@shared/protocol';
import { send } from '@/client';
import { useStore } from '@/store';
import { askNick, storedNick } from './nick';

const SEEN = 'asm.agents.welcomed';

const seen = (): boolean => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true; // cannot remember it: do not nag
  }
};

/** Resolves with the connection state once the daemon answered (or null after `ms`). */
function connections(ms: number): Promise<AgentConnection[] | null> {
  return new Promise((resolve) => {
    let unsub = (): void => {};
    const done = (v: AgentConnection[] | null): void => {
      clearTimeout(timer);
      unsub();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), ms);
    let asked = false;
    const look = (s: ReturnType<typeof useStore.getState>): void => {
      if (s.connected && !asked) {
        asked = true;
        send({ type: 'agents.status' });
      }
      if (asked && s.agentConnections) done(s.agentConnections);
    };
    unsub = useStore.subscribe(look);
    look(useStore.getState());
  });
}

/**
 * The first start: ask what to call the user, then — once — look at the agent CLIs and, if Claude Code is not ready
 * (not installed / not signed in), open Agents › Connections so a new user can set it up.
 */
export async function firstRun(): Promise<void> {
  if (storedNick() === null) await askNick(true);
  if (seen()) return;
  const items = await connections(20_000);
  if (!items) return; // no answer: try again next start
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* not kept */
  }
  const claude = items.find((c) => c.kind === 'claude');
  if (!(claude?.installed && claude.signedIn !== false)) useStore.getState().openAgents();
}

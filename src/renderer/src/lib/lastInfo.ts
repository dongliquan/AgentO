import { useEffect } from 'react';
import { useStore } from '@/store';
import { send } from '@/client';

/**
 * Asks the daemon where each stopped session left off (what it was last asked, how its last answer ended): once for a
 * session seen stopped, and again when a session becomes stopped (its conversation moved on). The daemon answers in
 * small batches; the answers sit in the store's `lastInfo`.
 */
export function useLastInfoRequests(): void {
  useEffect(() => {
    const prev = new Map<string, string>();
    const asked = new Set<string>();
    const run = (): void => {
      const { sessions, lastInfo, connected } = useStore.getState();
      if (!connected) return;
      const want: string[] = [];
      for (const s of sessions.values()) {
        const stopped = s.status === 'hibernated' || s.status === 'done';
        const was = prev.get(s.id);
        prev.set(s.id, s.status);
        if (!stopped) {
          asked.delete(s.id);
          continue;
        }
        // newly stopped, or never asked for
        if ((was !== undefined && was !== s.status && !asked.has(s.id)) || (!lastInfo.has(s.id) && !asked.has(s.id))) {
          asked.add(s.id);
          want.push(s.id);
        }
      }
      for (let i = 0; i < want.length; i += 50) send({ type: 'session.last', ids: want.slice(i, i + 50) });
    };
    run();
    return useStore.subscribe(run);
  }, []);
}

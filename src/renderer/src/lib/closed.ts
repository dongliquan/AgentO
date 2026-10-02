import { useMemo } from 'react';
import type { InboxItem } from '@shared/protocol';
import { useStore } from '@/store';
import { closedProjectIds, closedSessionIds, openSessions } from './closedIds';

export { closedProjectIds, closedSessionIds, openSessions };

export function useClosedSessionIds(): Set<string> {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  return useMemo(() => closedSessionIds(sessions.values(), projects), [sessions, projects]);
}

/** The inbox without the records of closed projects (they come back when the project is opened). */
export function useOpenInbox(): InboxItem[] {
  const inbox = useStore((s) => s.inbox);
  const closed = useClosedSessionIds();
  return useMemo(() => (closed.size ? inbox.filter((i) => !closed.has(i.sessionId)) : inbox), [inbox, closed]);
}

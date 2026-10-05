import type { InboxItem, Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { closedProjectIds, closedSessionIds, openSessions } from './closedIds';
import { buildThreads, type LogNode } from './threads';

export { closedProjectIds, closedSessionIds, openSessions };

/*
 * Shared derived data. Many components need the same thing from the same store state (the closed sessions, the open
 * inbox, its threads); computing it once per state instead of once per component keeps every panel cheap. Each cache
 * holds the last result keyed by the inputs' identities — store updates replace those objects, so a new state
 * recomputes and an unchanged one is a hit. Callers must not mutate the results.
 */

let closedKey: [Map<string, Session>, Project[]] | null = null;
let closedVal: Set<string> = new Set();
function closedFor(sessions: Map<string, Session>, projects: Project[]): Set<string> {
  if (!closedKey || closedKey[0] !== sessions || closedKey[1] !== projects) {
    closedKey = [sessions, projects];
    closedVal = closedSessionIds(sessions.values(), projects);
  }
  return closedVal;
}

let inboxKey: [InboxItem[], Set<string>] | null = null;
let inboxVal: InboxItem[] = [];
function openInboxFor(inbox: InboxItem[], closed: Set<string>): InboxItem[] {
  if (!inboxKey || inboxKey[0] !== inbox || inboxKey[1] !== closed) {
    inboxKey = [inbox, closed];
    inboxVal = closed.size ? inbox.filter((i) => !closed.has(i.sessionId)) : inbox;
  }
  return inboxVal;
}

let threadsKey: InboxItem[] | null = null;
let threadsVal: LogNode[] = [];
/** The order threads of an inbox (oldest first), built once per inbox. Do not mutate — copy before reversing. */
export function threadsOf(inbox: InboxItem[]): LogNode[] {
  if (threadsKey !== inbox) {
    threadsKey = inbox;
    threadsVal = buildThreads(inbox);
  }
  return threadsVal;
}

export function useClosedSessionIds(): Set<string> {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  return closedFor(sessions, projects);
}

/** The inbox without the records of closed projects (they come back when the project is opened). */
export function useOpenInbox(): InboxItem[] {
  const inbox = useStore((s) => s.inbox);
  return openInboxFor(inbox, useClosedSessionIds());
}

/** Threads of the open inbox, shared by every panel (Orders, Tasks, Log, chips). */
export function useOpenThreads(): LogNode[] {
  return threadsOf(useOpenInbox());
}

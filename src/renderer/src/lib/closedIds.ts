import type { Project, Session } from '@shared/protocol';

/** Ids of closed projects. */
export function closedProjectIds(projects: Project[]): Set<string> {
  return new Set(projects.filter((p) => p.closed).map((p) => p.id));
}

/** Sessions of closed projects: off the Ground, the lists and the right panel until the project is opened again. */
export function closedSessionIds(sessions: Iterable<Session>, projects: Project[]): Set<string> {
  const closed = closedProjectIds(projects);
  const out = new Set<string>();
  if (closed.size === 0) return out;
  for (const s of sessions) if (closed.has(s.projectId)) out.add(s.id);
  return out;
}

/** Sessions of open projects. */
export function openSessions(sessions: Map<string, Session>, projects: Project[]): Session[] {
  const closed = closedProjectIds(projects);
  const all = [...sessions.values()];
  return closed.size ? all.filter((s) => !closed.has(s.projectId)) : all;
}

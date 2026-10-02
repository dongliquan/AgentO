import type { Project, Session } from '@shared/protocol';

/** Ids of closed projects and of their parts. */
export function closedProjectIds(projects: Project[]): Set<string> {
  const tops = new Set(projects.filter((p) => !p.parentId && p.closed).map((p) => p.id));
  return new Set(projects.filter((p) => tops.has(p.id) || (p.parentId !== undefined && tops.has(p.parentId))).map((p) => p.id));
}

/** Sessions of closed projects: off the Ground, the lists and the right panel until the project is opened again. */
export function closedSessionIds(sessions: Iterable<Session>, projects: Project[]): Set<string> {
  const closed = closedProjectIds(projects);
  const out = new Set<string>();
  if (closed.size === 0) return out;
  for (const s of sessions) if (closed.has(s.projectId)) out.add(s.id);
  return out;
}

/** Sessions of open projects (plus team-wide ones without a project). */
export function openSessions(sessions: Map<string, Session>, projects: Project[]): Session[] {
  const closed = closedProjectIds(projects);
  const all = [...sessions.values()];
  return closed.size ? all.filter((s) => !closed.has(s.projectId)) : all;
}

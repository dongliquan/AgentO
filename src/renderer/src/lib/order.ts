import type { Project, Session } from '@shared/protocol';
import { closedProjectIds } from './closedIds';

/** Sessions in the sidebar tree's order, grouped by project, for the Split and Tabs views. */
export interface SessionGroup {
  /** the project; undefined for sessions of no known project */
  project?: Project;
  name: string;
  color: string;
  items: { session: Session }[];
}

/** the manager's order (dragged in the tree), then creation time */
const bySortOrder = (a: Session, b: Session): number =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;

export function treeOrder(sessions: Map<string, Session>, projects: Project[]): SessionGroup[] {
  const closed = closedProjectIds(projects);
  const all = [...sessions.values()].filter((s) => !closed.has(s.projectId));
  const byProject = new Map<string, Session[]>();
  for (const s of all) byProject.set(s.projectId, [...(byProject.get(s.projectId) ?? []), s]);
  for (const list of byProject.values()) list.sort(bySortOrder);
  const groups: SessionGroup[] = [];
  const placed = new Set<string>();
  for (const p of projects.filter((x) => !closed.has(x.id))) {
    const items = (byProject.get(p.id) ?? []).map((session) => ({ session }));
    items.forEach((i) => placed.add(i.session.id));
    if (items.length) groups.push({ project: p, name: p.name, color: p.color ?? '#64748b', items });
  }
  const rest = all.filter((s) => !placed.has(s.id)).sort(bySortOrder);
  if (rest.length) groups.push({ name: 'Other', color: '#94a3b8', items: rest.map((session) => ({ session })) });
  return groups;
}

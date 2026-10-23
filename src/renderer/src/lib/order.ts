import type { Project, Session } from '@shared/protocol';
import { closedProjectIds } from './closedIds';

/** Sessions in the sidebar tree's order, grouped by project (parts marked), for the Split and Tabs views. */
export interface SessionGroup {
  /** the top-level project; undefined for the team-wide Head Coach and sessions of no known project */
  project?: Project;
  name: string;
  color: string;
  items: { session: Session; part?: Project }[];
}

const bySortOrder = (a: Session, b: Session): number =>
  // the project's coach first, then the manager's order (dragged in the tree), then creation time
  Number(b.role === 'coach') - Number(a.role === 'coach') || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;

export function treeOrder(sessions: Map<string, Session>, projects: Project[]): SessionGroup[] {
  const closed = closedProjectIds(projects);
  const all = [...sessions.values()].filter((s) => !closed.has(s.projectId));
  const byProject = new Map<string, Session[]>();
  for (const s of all) {
    if (s.role === 'head') continue;
    byProject.set(s.projectId, [...(byProject.get(s.projectId) ?? []), s]);
  }
  for (const list of byProject.values()) list.sort(bySortOrder);
  const groups: SessionGroup[] = [];
  const placed = new Set<string>();
  const teamHead = all.filter((s) => s.role === 'head' && !s.projectId);
  if (teamHead.length) {
    groups.push({ name: 'Team', color: '#64748b', items: teamHead.map((session) => ({ session })) });
    teamHead.forEach((s) => placed.add(s.id));
  }
  for (const p of projects.filter((x) => !x.parentId && !closed.has(x.id))) {
    const items: SessionGroup['items'] = [];
    for (const h of all.filter((s) => s.role === 'head' && s.projectId === p.id)) items.push({ session: h });
    for (const s of byProject.get(p.id) ?? []) items.push({ session: s });
    for (const part of projects.filter((x) => x.parentId === p.id)) for (const s of byProject.get(part.id) ?? []) items.push({ session: s, part });
    items.forEach((i) => placed.add(i.session.id));
    if (items.length) groups.push({ project: p, name: p.name, color: p.color ?? '#64748b', items });
  }
  const rest = all.filter((s) => !placed.has(s.id)).sort(bySortOrder);
  if (rest.length) groups.push({ name: 'Other', color: '#94a3b8', items: rest.map((session) => ({ session })) });
  return groups;
}

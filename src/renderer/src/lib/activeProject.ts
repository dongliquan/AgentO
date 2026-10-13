import type { Session } from '@shared/protocol';
import { useStore } from '@/store';

/**
 * The head coach to open the Ground on: the project in progress — its head coach working, else anyone in it working
 * or asking something, else the project with the latest activity. Closed projects are skipped.
 */
export function activeHeadCoach(): string | undefined {
  const { sessions, projects } = useStore.getState();
  const open = projects.filter((p) => !p.parentId && !p.closed);
  const all = [...sessions.values()];
  let best: { id: string; score: number; at: number } | undefined;
  for (const p of open) {
    const head = all.find((s) => s.role === 'head' && s.projectId === p.id);
    if (!head) continue;
    const ids = new Set([p.id, ...projects.filter((x) => x.parentId === p.id).map((x) => x.id)]);
    const members: Session[] = all.filter((s) => ids.has(s.projectId));
    const busy = (s: Session): boolean => s.status === 'working' || s.status === 'starting';
    const score = busy(head) ? 3 : members.some(busy) ? 2 : members.some((s) => s.attention) ? 1 : 0;
    const at = Math.max(head.updatedAt, ...members.map((s) => s.updatedAt));
    if (!best || score > best.score || (score === best.score && at > best.at)) best = { id: head.id, score, at };
  }
  return best?.id;
}

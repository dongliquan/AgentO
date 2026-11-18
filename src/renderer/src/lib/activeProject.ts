import { useStore } from '@/store';

/**
 * The session to open the Ground on: one that is working, else one asking something, else the one with the latest
 * activity. Sessions of closed projects are skipped.
 */
export function activeSession(): string | undefined {
  const { sessions, projects } = useStore.getState();
  const open = new Set(projects.filter((p) => !p.closed).map((p) => p.id));
  let best: { id: string; score: number; at: number } | undefined;
  for (const s of sessions.values()) {
    if (!open.has(s.projectId)) continue;
    const score = s.status === 'working' || s.status === 'starting' ? 2 : s.attention ? 1 : 0;
    if (!best || score > best.score || (score === best.score && s.updatedAt > best.at)) best = { id: s.id, score, at: s.updatedAt };
  }
  return best?.id;
}

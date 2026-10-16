import type { Session } from '@shared/protocol';
import { useStore } from '@/store';
import { pcStyle, projectColor, roleLabel } from '@/lib/format';

/**
 * Role tag of a session (none for a player). The team-wide Head Coach wears the manager's color (it works straight for
 * the user); a project's Coach wears its project's color.
 */
export function RoleTag({ s }: { s: Session }): JSX.Element | null {
  const color = useStore((st) => (s.role === 'head' && s.projectId ? projectColor(s.projectId, st.projects) : ''));
  if (s.role === 'player') return null;
  if (s.role === 'head' && !s.projectId) return <span className="role-tag manager">{roleLabel(s)}</span>;
  if (s.role === 'head') return <span className="role-tag project" style={pcStyle(color)}>{roleLabel(s)}</span>;
  return <span className={`role-tag ${s.role}`}>{roleLabel(s)}</span>;
}

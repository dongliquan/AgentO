import { useStore } from '@/store';
import { pcStyle, projectColor } from '@/lib/format';

/** The open top-level projects a list can be narrowed to ('' = all). A stale or closed id counts as all. */
export function useProjectFilter(value: string): { only: string; rootOf: (sessionId: string) => string | undefined } {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const only = projects.some((p) => p.id === value && !p.parentId && !p.closed) ? value : '';
  const rootOf = (sessionId: string): string | undefined => {
    const s = sessions.get(sessionId);
    const p = s ? projects.find((x) => x.id === s.projectId) : undefined;
    return p?.parentId ?? p?.id;
  };
  return { only, rootOf };
}

/** A row of project chips (All + each open project) that narrows the list below it. */
export function ProjectFilter({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element | null {
  const projects = useStore((s) => s.projects);
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  const { only } = useProjectFilter(value);
  if (tops.length < 2) return null;
  return (
    <div className="segmented project-filter" role="tablist" aria-label="Project">
      <button role="tab" aria-selected={!only} className={!only ? 'active' : ''} onClick={() => onChange('')} title="Every project">
        All
      </button>
      {tops.map((p) => (
        <button key={p.id} role="tab" aria-selected={only === p.id} className={only === p.id ? 'active' : ''} style={pcStyle(projectColor(p.id, projects))} onClick={() => onChange(p.id)} title={p.name}>
          <span className="pf-dot" />
          <span className="ellipsis">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

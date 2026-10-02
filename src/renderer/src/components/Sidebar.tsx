import { useStore, type TreeFilter } from '@/store';
import { newProject } from '@/commands';
import { ProjectTree } from './ProjectTree';

const FILTERS: { id: TreeFilter; label: string }[] = [
  { id: 'all', label: 'Sessions + Files' },
  { id: 'sessions', label: 'Sessions' }
];

/** Left sidebar: the project tree (Manager, projects ⊃ parts, folders, sessions), with a sessions-only filter. */
export function Sidebar(): JSX.Element {
  const filter = useStore((s) => s.treeFilter);
  const setFilter = useStore((s) => s.setTreeFilter);
  const setRightTab = useStore((s) => s.setRightTab);

  return (
    <div className="sidebar">
      {/* the manager is the user, above every project: gives orders from the Orders tab */}
      <div className="sidebar-manager" title="You are the manager — your tasks: what you ordered and where it stands" onClick={() => setRightTab('tasks')}>
        <span className="manager-ico">♛</span>
        <span className="label">Manager (You)</span>
        <span className="role-tag manager">MANAGER</span>
      </div>
      <div className="sidebar-header">
        <span>PROJECTS</span>
        <span className="grow" />
        <button className="icon-btn" title="New Project" onClick={() => void newProject()}>+</button>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <ProjectTree />
    </div>
  );
}

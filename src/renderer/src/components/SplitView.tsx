import { useStore } from '@/store';
import { openSessions } from '@/lib/closedIds';
import { newSessionFor } from '@/commands';
import { SessionCard } from './SessionCard';

export function SplitView(): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const selectedId = useStore((s) => s.selectedId);
  const projects = useStore((s) => s.projects);
  const list = openSessions(sessions, projects).sort((a, b) => a.createdAt - b.createdAt);
  if (list.length === 0) {
    return (
      <div className="board-empty" style={{ position: 'relative', flex: 1 }}>
        <div>No sessions yet</div>
        <button className="btn primary" onClick={() => newSessionFor()}>+ New Session</button>
      </div>
    );
  }
  return (
    <div className="split">
      {list.map((s) => (
        <div className="cell" key={s.id}>
          <SessionCard session={s} layout="static" selected={selectedId === s.id} />
        </div>
      ))}
    </div>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/store';
import { treeOrder } from '@/lib/order';
import { pcStyle } from '@/lib/format';
import { newSessionFor } from '@/commands';
import { SessionCard } from './SessionCard';

export function SplitView(): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const selectedId = useStore((s) => s.selectedId);
  const projects = useStore((s) => s.projects);
  // the sidebar tree's order: project by project (a header each), coach first, then parts
  const groups = useMemo(() => treeOrder(sessions, projects), [sessions, projects]);
  const list = groups.flatMap((g) => g.items.map((i) => i.session));
  // a session picked elsewhere (the tree, a notification, a report) is brought into view here
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const cell = grid.current?.querySelector<HTMLElement>(`.cell[data-session="${selectedId}"]`);
    // the picked cell at the top of the grid (the grid's padding above it), like a list scrolled to an entry
    const g = grid.current;
    if (!cell || !g) return;
    // offsetTop would be measured from the app shell (the grid is not positioned), so use rects
    const top = cell.getBoundingClientRect().top - g.getBoundingClientRect().top + g.scrollTop;
    g.scrollTo({ top: Math.max(0, top - 10), behavior: 'smooth' });
  }, [selectedId]);
  if (list.length === 0) {
    return (
      <div className="board-empty" style={{ position: 'relative', flex: 1 }}>
        <div>No sessions yet</div>
        <button className="btn primary" onClick={() => newSessionFor()}>+ New Session</button>
      </div>
    );
  }
  return (
    <div className="split" ref={grid}>
      {/* the tree's order, four to a screen (2 × 2): each cell wears its project's color and names its project › part */}
      {groups.flatMap((g) =>
        g.items.map(({ session: s, part }) => (
          <div className={`cell ${selectedId === s.id ? 'selected' : ''}`} key={s.id} data-session={s.id} style={pcStyle(g.color)} title={`${g.name}${part ? ` › ${part.name}` : ''}`}>
            <span className="cell-tag">{g.name}{part ? ` › ${part.name}` : ''}</span>
            <SessionCard session={s} layout="static" selected={selectedId === s.id} />
          </div>
        ))
      )}
    </div>
  );
}

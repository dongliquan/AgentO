import { statusClass } from '@/lib/format';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { openSessions } from '@/lib/closedIds';
import { newSessionFor } from '@/commands';
import { SessionCard } from './SessionCard';
import { AgentIcon } from './AgentIcon';

export function TabView(): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeTabSessionId);
  const setActive = useStore((s) => s.setActiveTabSession);
  const select = useStore((s) => s.select);
  const projects = useStore((s) => s.projects);
  const list = openSessions(sessions, projects).sort((a, b) => a.createdAt - b.createdAt);
  const active = activeId ? sessions.get(activeId) : undefined;

  useEffect(() => {
    if (!active && list.length > 0) setActive(list[0].id);
  }, [active, list, setActive]);

  if (list.length === 0) {
    return (
      <div className="board-empty" style={{ position: 'relative', flex: 1 }}>
        <div>No sessions yet</div>
        <button className="btn primary" onClick={() => newSessionFor()}>+ New Session</button>
      </div>
    );
  }
  return (
    <div className="tabview">
      <div className="tabstrip">
        {list.map((s) => (
          <button
            key={s.id}
            className={`tab ${s.id === active?.id ? 'active' : ''}`}
            onClick={() => {
              setActive(s.id);
              select(s.id);
            }}
            title={s.cwd}
          >
            <span className={`status-dot ${statusClass(s)}`} />
            <AgentIcon kind={s.agent} color={s.color} />
            <span className="ellipsis">{s.title}</span>
          </button>
        ))}
      </div>
      <div className="tab-main">{active && <SessionCard key={active.id} session={active} layout="fill" selected />}</div>
    </div>
  );
}

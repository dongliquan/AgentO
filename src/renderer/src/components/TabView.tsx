import { statusClass } from '@/lib/format';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/store';
import { treeOrder, type SessionGroup } from '@/lib/order';
import { pcStyle } from '@/lib/format';
import { newSessionFor } from '@/commands';
import { SessionCard } from './SessionCard';
import { AgentIcon } from './AgentIcon';

const groupKey = (g: SessionGroup): string => g.project?.id ?? g.name;

export function TabView(): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeTabSessionId);
  const setActive = useStore((s) => s.setActiveTabSession);
  const select = useStore((s) => s.select);
  const projects = useStore((s) => s.projects);
  // the sidebar tree's order: a row of project groups, then the active group's sessions as tabs
  const groups = useMemo(() => treeOrder(sessions, projects), [sessions, projects]);
  const list = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.session)), [groups]);
  const active = activeId ? sessions.get(activeId) : undefined;
  const activeGroup = groups.find((g) => g.items.some((i) => i.session.id === active?.id)) ?? groups[0];
  // the tab last shown in each group, so switching groups and back lands where it was
  const lastIn = useRef(new Map<string, string>());
  if (active && activeGroup) lastIn.current.set(groupKey(activeGroup), active.id);

  useEffect(() => {
    if (!active && list.length > 0) setActive(list[0].id);
  }, [active, list, setActive]);

  const open = (id: string): void => {
    setActive(id);
    select(id);
  };
  const openGroup = (g: SessionGroup): void => {
    const remembered = lastIn.current.get(groupKey(g));
    const target = (remembered && g.items.find((i) => i.session.id === remembered)) ?? g.items[0];
    if (target) open(target.session.id);
  };

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
      <div className="tab-projects">
        {groups.map((g) => {
          const working = g.items.filter((i) => i.session.status === 'working' || i.session.status === 'starting').length;
          return (
            <button
              key={groupKey(g)}
              className={`tab-project ${g === activeGroup ? 'active' : ''}`}
              style={pcStyle(g.color)}
              onClick={() => openGroup(g)}
              title={`${g.name} · ${g.items.length} session${g.items.length === 1 ? '' : 's'}${working ? ` · ${working} working` : ''}`}
            >
              <span className={`pc-dot ${working ? 'agg-working' : ''}`} />
              <span className="ellipsis">{g.name}</span>
              <span className="count">{g.items.length}</span>
            </button>
          );
        })}
      </div>
      <div className="tabstrip" style={pcStyle(activeGroup?.color ?? '#64748b')}>
        {activeGroup?.items.map(({ session: s, part }) => (
          <button key={s.id} className={`tab ${s.id === active?.id ? 'active' : ''}`} onClick={() => open(s.id)} title={`${part ? `${part.name} › ` : ''}${s.title}\n${s.cwd}`}>
            <span className={`status-dot ${statusClass(s)}`} />
            <AgentIcon kind={s.agent} color={s.color} />
            {part && <span className="tab-part">{part.name}</span>}
            <span className="ellipsis">{s.title}</span>
          </button>
        ))}
      </div>
      <div className="tab-main">{active && <SessionCard key={active.id} session={active} layout="fill" selected />}</div>
    </div>
  );
}

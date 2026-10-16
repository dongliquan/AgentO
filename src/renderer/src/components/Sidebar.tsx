import { useState } from 'react';
import { useStore, type TreeFilter } from '@/store';
import { send } from '@/client';
import { AgentPicker } from './AgentPicker';
import { newProject } from '@/commands';
import { ProjectTree, SessionRow } from './ProjectTree';
import { SidebarOrders } from './SidebarOrders';

const FILTERS: { id: TreeFilter; label: string }[] = [
  { id: 'all', label: 'Sessions + Files' },
  { id: 'sessions', label: 'Sessions' }
];

/** Left sidebar: the project tree (Manager, projects ⊃ parts, folders, sessions), with a sessions-only filter. */
export function Sidebar(): JSX.Element {
  const filter = useStore((s) => s.treeFilter);
  const setFilter = useStore((s) => s.setTreeFilter);
  const setRightTab = useStore((s) => s.setRightTab);
  const [chatAt, setChatAt] = useState<{ x: number; y: number } | null>(null);
  const teamHead = useStore((s) => {
    for (const x of s.sessions.values()) if (x.role === 'head' && !x.projectId) return x;
    return undefined;
  });

  return (
    <div className="sidebar">
      {/* the manager is the user, above every project: gives orders from the Manager tab */}
      <div className="sidebar-manager" title="You are the manager — your orders and the answers (Manager tab)" onClick={() => setRightTab('orders')}>
        <span className="manager-ico">♛</span>
        <span className="label">Welcome</span>
        <span className="role-tag manager">MANAGER</span>
        <button
          className="icon-btn manager-usage"
          title="Token usage — by project, time, session, role and model"
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().openUsage();
          }}
        >
          {/* outline bar chart, drawn like the toolbar icons (16px, currentColor) */}
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2.5 13.5h11" stroke="currentColor" strokeLinecap="round" fill="none" />
            <rect x="3.5" y="8" width="2" height="4" rx="0.5" fill="none" stroke="currentColor" />
            <rect x="7" y="5" width="2" height="7" rx="0.5" fill="none" stroke="currentColor" />
            <rect x="10.5" y="2.5" width="2" height="9.5" rx="0.5" fill="none" stroke="currentColor" />
          </svg>
        </button>
      </div>
      {/* the manager's orders sit above the projects they go to */}
      <SidebarOrders />
      {/* the team-wide Head Coach: between the manager's orders and the projects it routes them to */}
      {teamHead && (
        <div className="sidebar-head">
          <SessionRow session={teamHead} depth={10} />
        </div>
      )}
      <div className="sidebar-header">
        <span>PROJECTS</span>
        <span className="grow" />
        <button
          className="icon-btn"
          title="New Chat — a session just to talk to ChatGPT or Claude"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setChatAt({ x: r.left, y: r.bottom + 2 });
          }}
        >
          💬
        </button>
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
      {chatAt && (
        <AgentPicker
          x={chatAt.x}
          y={chatAt.y}
          kinds={['codex', 'claude']}
          title="New chat with"
          onPick={(agent) => {
            send({ type: 'chat.new', agent });
            setChatAt(null);
          }}
          onClose={() => setChatAt(null)}
        />
      )}
    </div>
  );
}


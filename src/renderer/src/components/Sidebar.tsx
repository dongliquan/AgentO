import { useState } from 'react';
import { useStore } from '@/store';
import { send } from '@/client';
import { AgentPicker } from './AgentPicker';
import { newProject } from '@/commands';
import { ProjectTree, SessionRow } from './ProjectTree';
import { SidebarOrders } from './SidebarOrders';
import { useReport } from './DailyReport';

/** Left sidebar: the project tree (Manager, projects ⊃ parts, sessions). Folders and files are in the right panel's Files tab. */
export function Sidebar(): JSX.Element {
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
          title="Report — what was done each day, and the to-do list for the next"
          onClick={(e) => {
            e.stopPropagation();
            useReport.getState().show();
          }}
        >
          {/* a checklist, drawn like the toolbar icons (16px, currentColor) */}
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" />
            <path d="M5 6l1 1 2-2M5 10l1 1 2-2M9.5 6.5h2M9.5 10.5h2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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

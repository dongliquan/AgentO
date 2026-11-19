import { useState } from 'react';
import { useStore } from '@/store';
import { send } from '@/client';
import { AgentPicker } from './AgentPicker';
import { newProject } from '@/commands';
import { ProjectTree } from './ProjectTree';
import { askNick, useNick } from '@/lib/nick';

/** Left sidebar: the project tree (projects, sessions). Folders and files are in the right panel's Files tab. */
export function Sidebar(): JSX.Element {
  const nick = useNick();
  const [chatAt, setChatAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="sidebar">
      {/* the name you go by, and the token usage report */}
      <div className="sidebar-manager">
        <span className="manager-ico">♛</span>
        <span className="label" title="Double-click to change what you are called" onDoubleClick={() => void askNick()}>
          {nick || 'Welcome'}
        </span>
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
      <div className="sidebar-header">
        <button className="panel-title" onClick={() => useStore.getState().toggleSidebar()} title="Fold the panel to its title"><span className="caret">▾</span>PROJECTS</button>
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

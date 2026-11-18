import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useExpanded } from './FileTree';
import type { AgentKind, Folder, Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { removeSession, renameProject, renameSession, saveProject, selectAndReveal } from '@/commands';
import { AGENT_LABELS, displayTitle } from '@/lib/format';
import { pcStyle, projectColor } from '@/lib/format';
import { useColorMenu } from './ProjectColorMenu';
import { AgentPicker } from './AgentPicker';
import { AgentIcon } from './AgentIcon';
import { useNeedsIds } from './NeedsYou';
import { presence } from '@/lib/presence';


interface PickerState {
  x: number;
  y: number;
  project: Project;
  folder: Folder;
}

export function ProjectTree(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const [expanded, toggle] = useExpanded();

  const [picker, setPicker] = useState<PickerState | null>(null);
  const openNewSession = useStore((s) => s.openNewSession);

  // expand every project by default (once)
  useEffect(() => {
    for (const p of projects) if (!expanded.has(`p:${p.id}`) && !expanded.has(`p!:${p.id}`)) {
      toggle(`p:${p.id}`, true);
      toggle(`p!:${p.id}`, true); // marker: initial expansion done
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // sessions belong to a project; the folder is only their working directory
  const sessionsByProject = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions.values()) {
      const arr = m.get(s.projectId) ?? [];
      arr.push(s);
      m.set(s.projectId, arr);
    }
    const key = (s: Session): number => s.order ?? Number.MAX_SAFE_INTEGER;
    for (const arr of m.values()) arr.sort((a, b) => key(a) - key(b) || a.createdAt - b.createdAt);
    return m;
  }, [sessions]);
  const tops = projects.filter((p) => !p.closed);
  const closedTops = projects.filter((p) => p.closed);

  const pick = (agent: AgentKind): void => {
    if (!picker) return;
    const { project, folder } = picker;
    send({ type: 'session.create', projectId: project.id, folderId: folder.id, agent, title: `${AGENT_LABELS[agent]} · ${folder.name}`, cols: 100, rows: 30 });
    setPicker(null);
  };

  /** A project: its sessions (its folders are in the Files tab). */
  const renderNode = (p: Project, depth: number): JSX.Element => {
    const open = expanded.has(`p:${p.id}`);
    const own = sessionsByProject.get(p.id) ?? [];
    const total = own.length;
    // the project's state = its sessions' together
    const agg = aggregateStatus(own);
    const inner = depth + 14;
    return (
      // a project's block is tinted with its color, so each project reads as one area when expanded
      <div key={p.id} className="tree-project-block" style={pcStyle(projectColor(p.id, projects))}>
        <div
          className="tree-row tree-project"
          style={{ paddingLeft: depth }}
          onClick={() => toggle(`p:${p.id}`)}
          {...dropInto(p.id, p)}
          {...dragProject(p)}
          onContextMenu={(e) => {
            e.preventDefault();
            const f = p.folders[0];
            if (f) setPicker({ x: e.clientX, y: e.clientY, project: p, folder: f });
            else openNewSession({ projectId: p.id });
          }}
        >
          <span className="caret">{open ? '▾' : '▸'}</span>
          <button
            className={`pc-dot tree-pc agg-${agg.state}`}
            style={pcStyle(projectColor(p.id, projects))}
            title={`${agg.text} — click to choose the project color`}
            onClick={(e) => {
              e.stopPropagation();
              useColorMenu.getState().show({ x: e.clientX, y: e.clientY, projectId: p.id });
            }}
          />
          <span className="label" style={{ fontWeight: 600 }} onDoubleClick={(e) => { e.stopPropagation(); void renameProject(p.id); }} title="Double-click to rename">
            {p.name}
            {total > 0 && <span className="muted tree-count" title={`${total} session(s)`}> ({total})</span>}
          </span>
          <button
            className="icon-btn hover-act"
            title="Rename project (or double-click the name)"
            onClick={(e) => {
              e.stopPropagation();
              void renameProject(p.id);
            }}
          >
            ✎
          </button>
          <button
            className="icon-btn hover-act"
            title="New Session"
            onClick={(e) => {
              e.stopPropagation();
              const f = p.folders[0];
              if (!f) {
                openNewSession({ projectId: p.id });
                return;
              }
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setPicker({ x: r.left, y: r.bottom + 2, project: p, folder: f });
            }}
          >
            ›_
          </button>
          <button
            className="icon-btn hover-act"
            title="Add Folder"
            onClick={(e) => {
              e.stopPropagation();
              void window.desktop.pickFolder().then((path) => {
                if (path) send({ type: 'folder.add', projectId: p.id, path });
              });
            }}
          >
            +
          </button>
          <button
            className="icon-btn hover-act"
            title="Save Project As… (.agento file: folders, sessions, layout)"
            onClick={(e) => {
              e.stopPropagation();
              void saveProject(p.id);
            }}
          >
            ⤓
          </button>
          {/* a project is deleted only from Closed (close it first) — too close to ⏏ otherwise */}
          <button
            className="icon-btn hover-act"
            title="Close Project — its sessions stop (resumable); everything is kept. Reopen it from Closed below."
            onClick={(e) => {
              e.stopPropagation();
              send({ type: 'project.close', id: p.id });
            }}
          >
            ⏏
          </button>
        </div>
        {open && own.map((s) => <SessionRow key={s.id} session={s} depth={inner} />)}
        {open && own.length === 0 && <div className="tree-empty" style={{ paddingLeft: inner + 8 }}>No sessions.</div>}
      </div>
    );
  };

  return (
    <div className="tree">
      {tops.length === 0 && <div className="tree-empty">No projects yet. Create one with + above, then add folders.</div>}
      {tops.map((p) => renderNode(p, 6))}
      {closedTops.length > 0 && (
        // pinned to the bottom of the sidebar, below however many open projects there are
        <div className="tree-closed-block">
          <div className="tree-row tree-closed-head" style={{ paddingLeft: 6 }} onClick={() => toggle('closed')} title="Closed projects: kept with their sessions, layout and history">
            <span className="caret">{expanded.has('closed') ? '▾' : '▸'}</span>
            <span className="label">Closed</span>
            <span className="muted" style={{ fontSize: 11 }}>{closedTops.length}</span>
          </div>
          {expanded.has('closed') &&
            closedTops.map((p) => {
              const n = [...sessions.values()].filter((s) => s.projectId === p.id).length;
              return (
                <div key={p.id} className="tree-row tree-closed" style={{ paddingLeft: 20 }} onDoubleClick={() => send({ type: 'project.open', id: p.id })} title="Double-click or Open to put it back on the Ground">
                  <span className="caret" />
                  <span className="label">{p.name}</span>
                  {n > 0 && <span className="muted" style={{ fontSize: 11 }}>{n}</span>}
                  <button className="btn sm ghost" onClick={() => send({ type: 'project.open', id: p.id })}>Open</button>
                  <button
                    className="icon-btn hover-act"
                    title="Delete Project"
                    onClick={() => {
                      if (window.confirm(`Delete project "${p.name}"?

Removed from AgentO: its sessions and their records.
Not touched: your folders on disk and the Claude / Codex conversation files.`)) send({ type: 'project.delete', id: p.id });
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
        </div>
      )}
      {picker && (
        <AgentPicker
          x={picker.x}
          y={picker.y}
          onPick={pick}
          onMore={() => {
            openNewSession({ projectId: picker.project.id, folderId: picker.folder.id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/* ---------- drag a session: reorder within its project, or drop it into another project ---------- */

const DRAG_TYPE = 'application/x-agento-session';
const PROJECT_DRAG = 'application/x-agento-project';

/** A project row can be dragged before another project. */
function dragProject(p: Project): React.HTMLAttributes<HTMLDivElement> & { draggable: boolean } {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(PROJECT_DRAG, p.id);
      e.dataTransfer.effectAllowed = 'move';
    }
  };
}

/** Drop target props for a project row: a dragged project goes before it. */
function dropProject(p: Project, e: React.DragEvent<HTMLDivElement>, phase: 'over' | 'leave' | 'drop'): boolean {
  if (!e.dataTransfer.types.includes(PROJECT_DRAG)) return false;
  if (phase === 'leave') {
    e.currentTarget.classList.remove('drop-before');
    return true;
  }
  e.preventDefault();
  if (phase === 'over') {
    e.currentTarget.classList.add('drop-before');
    return true;
  }
  e.currentTarget.classList.remove('drop-before');
  const id = e.dataTransfer.getData(PROJECT_DRAG);
  if (id && id !== p.id) send({ type: 'project.move', id, beforeId: p.id });
  return true;
}

/** Drop target props for a project row: the session goes last in it. */
function dropInto(projectId: string, project?: Project): React.HTMLAttributes<HTMLDivElement> {
  return {
    onDragOver: (e) => {
      if (project && dropProject(project, e, 'over')) return;
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.currentTarget.classList.add('drop-into');
    },
    onDragLeave: (e) => {
      if (project) dropProject(project, e, 'leave');
      e.currentTarget.classList.remove('drop-into');
    },
    onDrop: (e) => {
      if (project && dropProject(project, e, 'drop')) return;
      e.currentTarget.classList.remove('drop-into');
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id) {
        e.preventDefault();
        send({ type: 'session.move', id, projectId });
      }
    }
  };
}

export function SessionRow({ session: s, depth }: { session: Session; depth: number }): JSX.Element {
  const selected = useStore((st) => st.selectedId === s.id);
  const movable = true;
  return (
    <div
      className={`tree-row ${selected ? 'selected' : ''}`}
      style={{ paddingLeft: depth }}
      onClick={() => selectAndReveal(s.id)}
      draggable={movable}
      onDragStart={(e) => {
        if (!movable) return;
        e.dataTransfer.setData(DRAG_TYPE, s.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!movable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.currentTarget.classList.add('drop-before');
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('drop-before')}
      onDrop={(e) => {
        e.currentTarget.classList.remove('drop-before');
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id || id === s.id) return;
        e.preventDefault();
        e.stopPropagation();
        // dropped on a session: into its project, just before it
        send({ type: 'session.move', id, projectId: s.projectId, beforeId: s.id });
      }}
      title={`${AGENT_LABELS[s.agent]} · ${s.status}
${s.cwd}`}
    >
      {/* like the Files tree: rows with children have an arrow, a session (a leaf) has its icon */}
      <span className="caret" />
      <SessionIcon s={s} />
      <span className="label" onDoubleClick={(e) => { e.stopPropagation(); void renameSession(s.id); }}>
        {displayTitle(s)}
      </span>
      <button
        className="icon-btn hover-act"
        title="Rename (F2, or double-click the name)"
        onClick={(e) => {
          e.stopPropagation();
          void renameSession(s.id);
        }}
      >
        ✎
      </button>
      <button
        className="icon-btn hover-act"
        title="Remove Session (Delete)"
        onClick={(e) => {
          e.stopPropagation();
          removeSession(s.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

type AggState = 'error' | 'needs' | 'working' | 'idle' | 'off';

/**
 * One state for a group of sessions, the most urgent first: a session failed · one asks something (a prompt) · someone
 * is working · all idle · all stopped. With counts for the tooltip.
 */
function aggregateStatus(list: Session[]): { state: AggState; text: string } {
  const n = (f: (s: Session) => boolean): number => list.filter(f).length;
  const error = n((s) => s.status === 'error');
  const needs = n((s) => s.status === 'waiting' && s.attention === true);
  const working = n((s) => s.status === 'working' || s.status === 'starting');
  const idle = n((s) => s.status === 'waiting' && s.attention !== true);
  const parts = [working && `${working} working`, needs && `${needs} need input`, error && `${error} error`, idle && `${idle} idle`].filter(Boolean);
  const text = parts.length ? parts.join(' · ') : list.length ? 'all stopped' : 'no sessions';
  const state: AggState = error ? 'error' : needs ? 'needs' : working ? 'working' : idle ? 'idle' : 'off';
  return { state, text };
}

/**
 * A session's icon with its state on it, like a messenger's presence dot: a badge at the corner while it works
 * (pulsing), needs an answer, hit its limit or failed; nothing while idle; the icon faded while it is not running.
 */
function SessionIcon({ s }: { s: Session }): JSX.Element {
  const asked = useNeedsIds((n) => n.ids.has(s.id));
  const p = presence(s, asked);
  const badge = p.kind === 'idle' || p.kind === 'off' ? null : p.kind;
  const off = p.kind === 'off';
  // a stopped session says where it left off
  const last = useStore((st) => (off ? st.lastInfo.get(s.id) : undefined));
  const tip = last ? `${p.label}
Asked: ${last.ask}
Left at: ${last.reply}` : p.label;
  return (
    <span className={`tree-icon ${off ? 'off' : ''}`} title={tip}>
      <AgentIcon kind={s.agent} color={s.color} />
      {badge && <span className={`tree-badge ${badge}`} />}
    </span>
  );
}

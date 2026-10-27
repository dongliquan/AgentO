import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useExpanded } from './FileTree';
import type { AgentKind, Folder, Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { organizeTeam, removeSession, renameProject, renameSession, saveProject, selectAndReveal } from '@/commands';
import { askText } from '@/lib/prompt';
import { AGENT_LABELS, displayTitle, statusClass } from '@/lib/format';
import { RoleTag } from './RoleTag';
import { DelegationChip } from './Delegations';
import { pcStyle, projectColor } from '@/lib/format';
import { useColorMenu } from './ProjectColorMenu';
import { AgentPicker } from './AgentPicker';
import { AgentIcon } from './AgentIcon';


interface PickerState {
  x: number;
  y: number;
  project: Project;
  folder: Folder;
}

/** Coaches ask and review; they may run on another vendor. Players (coding) stay on Claude. */
const COACH_KINDS: AgentKind[] = ['claude', 'codex', 'gemini'];

export function ProjectTree(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const [expanded, toggle] = useExpanded();

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [coachPicker, setCoachPicker] = useState<{ x: number; y: number; projectId: string } | null>(null);
  const openNewSession = useStore((s) => s.openNewSession);

  // expand every project by default (once)
  useEffect(() => {
    for (const p of projects) if (!expanded.has(`p:${p.id}`) && !expanded.has(`p!:${p.id}`)) {
      toggle(`p:${p.id}`, true);
      toggle(`p!:${p.id}`, true); // marker: initial expansion done
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // sessions belong to a project; the folder is only their working directory. Coach first, then players.
  const sessionsByProject = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sessions.values()) {
      if (s.role === 'head') continue;
      const arr = m.get(s.projectId) ?? [];
      arr.push(s);
      m.set(s.projectId, arr);
    }
    const key = (s: Session): number => s.order ?? Number.MAX_SAFE_INTEGER;
    for (const arr of m.values()) arr.sort((a, b) => Number(b.role === 'coach') - Number(a.role === 'coach') || key(a) - key(b) || a.createdAt - b.createdAt);
    return m;
  }, [sessions]);
  const heads = useMemo(() => [...sessions.values()].filter((s) => s.role === 'head'), [sessions]);
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  const closedTops = projects.filter((p) => !p.parentId && p.closed);
  const partsOf = (id: string): Project[] => projects.filter((p) => p.parentId === id);

  const pick = (agent: AgentKind): void => {
    if (!picker) return;
    const { project, folder } = picker;
    send({ type: 'session.create', projectId: project.id, folderId: folder.id, agent, title: `${AGENT_LABELS[agent]} · ${folder.name}`, cols: 100, rows: 30 });
    setPicker(null);
  };

  const addPart = async (project: Project): Promise<void> => {
    const name = await askText(`New part of "${project.name}"`, { placeholder: 'e.g. Planning, Development, QA' });
    if (name && name.trim()) send({ type: 'project.create', name: name.trim(), parentId: project.id });
  };

  /** A project (depth 6) or a part (depth 20): its sessions (coach first), folders, and for a project its head coach and parts. */
  const renderNode = (p: Project, depth: number): JSX.Element => {
    const isPart = Boolean(p.parentId);
    const open = expanded.has(`p:${p.id}`);
    const parts = isPart ? [] : partsOf(p.id);
    const own = sessionsByProject.get(p.id) ?? [];
    const total = own.length + parts.reduce((n, x) => n + (sessionsByProject.get(x.id)?.length ?? 0), 0) + (isPart ? 0 : heads.filter((h) => h.projectId === p.id).length);
    const hasCoach = own.some((s) => s.role === 'coach');
    // the project's state = its head coach's and sessions' together (parts: their own sessions)
    const members = [...own, ...parts.flatMap((x) => sessionsByProject.get(x.id) ?? []), ...(isPart ? [] : heads.filter((h) => h.projectId === p.id))];
    const agg = aggregateStatus(members);
    const head = isPart ? undefined : heads.find((h) => h.projectId === p.id);
    const inner = depth + 14;
    const kind = isPart ? 'Part' : 'Project';
    return (
      // a top-level project's block is tinted with its color, so each project reads as one area when expanded
      <div key={p.id} className={isPart ? undefined : 'tree-project-block'} style={isPart ? undefined : pcStyle(projectColor(p.id, projects))}>
        <div
          className={`tree-row ${isPart ? 'tree-part' : 'tree-project'}`}
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
          {/* an arrow only when there is something under it */}
          <span className="caret">{(isPart ? own.length > 0 : true) ? (open ? '▾' : '▸') : ''}</span>
          {!isPart && (
            <button
              className={`pc-dot tree-pc agg-${agg.state}`}
              style={pcStyle(projectColor(p.id, projects))}
              title={`${agg.text} — click to choose the project color`}
              onClick={(e) => {
                e.stopPropagation();
                useColorMenu.getState().show({ x: e.clientX, y: e.clientY, projectId: p.id });
              }}
            />
          )}
          {isPart && members.length > 0 && <span className={`status-dot ${AGG_DOT[agg.state]}`} title={agg.text} />}
          <span className="label" style={{ fontWeight: 600 }} onDoubleClick={(e) => { e.stopPropagation(); void renameProject(p.id); }} title="Double-click to rename">
            {p.name}
            {!isPart && total > 0 && <span className="muted tree-count" title={`${total} session(s)`}> ({total})</span>}
          </span>
          <button
            className="icon-btn hover-act"
            title={`Rename ${isPart ? 'part' : 'project'} (or double-click the name)`}
            onClick={(e) => {
              e.stopPropagation();
              void renameProject(p.id);
            }}
          >
            ✎
          </button>
          {!isPart && (
            <button className="icon-btn hover-act" title="Add Part (e.g. planning, development, QA)" onClick={(e) => { e.stopPropagation(); void addPart(p); }}>
              ⊞
            </button>
          )}
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
          {!hasCoach && (isPart || parts.length === 0) && (
            <button
              className="icon-btn hover-act"
              title={`Add Coach (manages this ${kind.toLowerCase()}'s players)`}
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setCoachPicker({ x: r.left, y: r.bottom + 2, projectId: p.id });
              }}
            >
              ⚑
            </button>
          )}
          <button
            className="icon-btn hover-act"
            title={isPart ? 'Add Folder to the project' : 'Add Folder'}
            onClick={(e) => {
              e.stopPropagation();
              // folders belong to the project; a part works in its project's folders
              void window.desktop.pickFolder().then((path) => {
                if (path) send({ type: 'folder.add', projectId: p.parentId ?? p.id, path });
              });
            }}
          >
            +
          </button>
          {!isPart && (
            <button
              className="icon-btn hover-act"
              title="Organize Team — the project's coach (created first if needed) sorts the sessions into parts"
              onClick={(e) => {
                e.stopPropagation();
                organizeTeam(p.id);
              }}
            >
              ✦
            </button>
          )}
          {!isPart && (
            <button
              className="icon-btn hover-act"
              title="Save Project As… (.agento file: parts, sessions, layout, routines, log)"
              onClick={(e) => {
                e.stopPropagation();
                void saveProject(p.id);
              }}
            >
              ⤓
            </button>
          )}
          {!isPart && (
            <button
              className="icon-btn hover-act"
              title="Close Project — its sessions stop (resumable) and its routines pause; everything is kept. Reopen it from Closed below."
              onClick={(e) => {
                e.stopPropagation();
                send({ type: 'project.close', id: p.id });
              }}
            >
              ⏏
            </button>
          )}
          <button
            className="icon-btn hover-act"
            title={`Delete ${kind}`}
            onClick={(e) => {
              e.stopPropagation();
              const extra = parts.length ? ` and its ${parts.length} part(s)` : '';
              if (window.confirm(`Delete ${kind.toLowerCase()} "${p.name}"${extra}?

Removed from AgentO: its sessions, team folders, orders and reports, routines.
Not touched: your folders on disk and the Claude / Codex conversation files.`)) send({ type: 'project.delete', id: p.id });
            }}
          >
            ×
          </button>
        </div>
        {open && !isPart &&
          (head ? (
            <SessionRow session={head} depth={inner} />
          ) : (
            <div className="tree-row tree-add-head" style={{ paddingLeft: inner }} title="Optional: the project's PM — splits orders among the parts" onClick={() => send({ type: 'head.create', projectId: p.id })}>
              <span className="caret" />
              <span className="label">+ Coach</span>
              <button
                className="btn sm ghost tree-organize"
                title="Create the coach and have it sort this project's sessions into parts"
                onClick={(e) => {
                  e.stopPropagation();
                  organizeTeam(p.id);
                }}
              >
                ✦ Organize Team
              </button>
            </div>
          ))}
        {open && own.map((s) => <SessionRow key={s.id} session={s} depth={inner} />)}
        {open && parts.map((x) => renderNode(x, inner))}
        {open && isPart && own.length === 0 && <div className="tree-empty" style={{ paddingLeft: inner + 8 }}>No sessions.</div>}
      </div>
    );
  };

  return (
    <div className="tree">
      {tops.length === 0 && <div className="tree-empty">No projects yet. Create one with + above, then add parts or folders.</div>}
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
              const ids = new Set([p.id, ...partsOf(p.id).map((x) => x.id)]);
              const n = [...sessions.values()].filter((s) => ids.has(s.projectId)).length;
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

Removed from AgentO: its sessions, team folders, orders and reports, routines.
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
      {coachPicker && (
        <AgentPicker
          x={coachPicker.x}
          y={coachPicker.y}
          kinds={COACH_KINDS}
          title="Coach runs on"
          onPick={(agent) => {
            if (agent === 'claude' || agent === 'codex' || agent === 'gemini') send({ type: 'coach.create', projectId: coachPicker.projectId, agent });
            setCoachPicker(null);
          }}
          onClose={() => setCoachPicker(null)}
        />
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

/* ---------- drag a session: reorder within its part, or drop it into another part / project ---------- */

const DRAG_TYPE = 'application/x-agento-session';
const PROJECT_DRAG = 'application/x-agento-project';

/** A project row can be dragged before another project (a part before another part of the same project). */
function dragProject(p: Project): React.HTMLAttributes<HTMLDivElement> & { draggable: boolean } {
  const level = p.parentId ?? '';
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(PROJECT_DRAG, `${level}|${p.id}`);
      e.dataTransfer.effectAllowed = 'move';
    }
  };
}

/** Drop target props for a project row: a dragged project goes before it (same level only). */
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
  const [level, id] = e.dataTransfer.getData(PROJECT_DRAG).split('|');
  if (id && id !== p.id && level === (p.parentId ?? '')) send({ type: 'project.move', id, beforeId: p.id });
  return true;
}

/** Drop target props for a project / part row: the session goes last in it. */
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
  // the head coach stays at the project level; every other session can be dragged
  const movable = s.role !== 'head';
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
        // dropped on a session: into its part, just before it
        send({ type: 'session.move', id, projectId: s.projectId, beforeId: s.id });
      }}
      title={`${AGENT_LABELS[s.agent]} · ${s.status}
${s.cwd}`}
    >
      {/* like the Files tree: rows with children have an arrow, a session (a leaf) has its icon */}
      <span className="caret" />
      <AgentIcon kind={s.agent} color={s.color} />
      <span className={`status-dot ${statusClass(s)}`} />
      <span className="label" onDoubleClick={(e) => { e.stopPropagation(); void renameSession(s.id); }}>
        {displayTitle(s)}
      </span>
      <RoleTag s={s} />
      {s.role !== 'player' && <DelegationChip id={s.id} />}
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
/** the session status class a part's dot uses for each combined state */
const AGG_DOT: Record<AggState, string> = { error: 'error', needs: 'waiting', working: 'working', idle: 'idle', off: 'hibernated' };

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

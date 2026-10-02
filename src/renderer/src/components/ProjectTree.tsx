import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentKind, Folder, FsEntry, Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { requestChanged, requestList, send } from '@/client';
import { organizeTeam, removeSession, renameProject, renameSession, saveProject, selectAndReveal } from '@/commands';
import { askText } from '@/lib/prompt';
import { AGENT_LABELS, basename, fileIcon, roleLabel, displayTitle } from '@/lib/format';
import { pcStyle, projectColor } from '@/lib/format';
import { PROJECT_COLORS } from '@shared/protocol';
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

function useExpanded(): [Set<string>, (key: string, v?: boolean) => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string, v?: boolean) => {
    setSet((prev) => {
      const next = new Set(prev);
      const on = v ?? !next.has(key);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  return [set, toggle];
}

export function ProjectTree(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const filter = useStore((s) => s.treeFilter);
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
  const teamHead = heads.find((s) => !s.projectId); // a team-wide head coach from the earlier design
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
    const head = isPart ? undefined : heads.find((h) => h.projectId === p.id);
    const showFolders = filter !== 'sessions';
    const inner = depth + 14;
    const folderName = (id: string): string | undefined => (p.folders.length > 1 ? p.folders.find((f) => f.id === id)?.name : undefined);
    const kind = isPart ? 'Part' : 'Project';
    return (
      <div key={p.id}>
        <div
          className={`tree-row ${isPart ? 'tree-part' : 'tree-project'}`}
          style={{ paddingLeft: depth }}
          onClick={() => toggle(`p:${p.id}`)}
          {...dropInto(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            const f = p.folders[0];
            if (f) setPicker({ x: e.clientX, y: e.clientY, project: p, folder: f });
            else openNewSession({ projectId: p.id });
          }}
        >
          <span className="caret">{open ? '▾' : '▸'}</span>
          {!isPart && (
            <button
              className="pc-dot tree-pc"
              style={pcStyle(projectColor(p.id, projects))}
              title="Project color — click for the next one"
              onClick={(e) => {
                e.stopPropagation();
                const cur = PROJECT_COLORS.indexOf(projectColor(p.id, projects));
                send({ type: 'project.setColor', id: p.id, color: PROJECT_COLORS[(cur + 1) % PROJECT_COLORS.length]! });
              }}
            />
          )}
          <span className="label" style={{ fontWeight: 600 }} onDoubleClick={(e) => { e.stopPropagation(); void renameProject(p.id); }} title="Double-click to rename">{p.name}</span>
          {total > 0 && <span className="muted" style={{ fontSize: 11 }} title={`${total} session(s)`}>{total}</span>}
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
          {!isPart && (
            <button
              className="icon-btn hover-act"
              title="Organize Team — the head coach (created first if needed) sorts the sessions into parts and picks coaches"
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
              if (window.confirm(`Delete ${kind.toLowerCase()} "${p.name}"${extra}? (Its sessions are removed.)`)) send({ type: 'project.delete', id: p.id });
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
              <span className="label">+ Head Coach</span>
              <button
                className="btn sm ghost tree-organize"
                title="Create the head coach and have it sort this project's sessions into parts with coaches"
                onClick={(e) => {
                  e.stopPropagation();
                  organizeTeam(p.id);
                }}
              >
                ✦ Organize Team
              </button>
            </div>
          ))}
        {open && own.map((s) => <SessionRow key={s.id} session={s} depth={inner} folderName={folderName(s.folderId)} />)}
        {open && parts.map((x) => renderNode(x, inner))}
        {open && isPart && !showFolders && own.length === 0 && <div className="tree-empty" style={{ paddingLeft: inner + 8 }}>No sessions.</div>}
        {open && showFolders && isPart && p.folders.length === 0 && <div className="tree-empty" style={{ paddingLeft: inner + 8 }}>No folders.</div>}
        {open &&
          showFolders &&
          p.folders.map((f) => (
            <FolderNode
              key={f.id}
              project={p}
              folder={f}
              depth={inner}
              expanded={expanded}
              toggle={toggle}
              filter={filter}
              onNewSession={(x, y) => setPicker({ x, y, project: p, folder: f })}
            />
          ))}
      </div>
    );
  };

  return (
    <div className="tree">
      {teamHead && <SessionRow session={teamHead} depth={20} />}
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
                      if (window.confirm(`Delete project "${p.name}"? (Its sessions are removed.)`)) send({ type: 'project.delete', id: p.id });
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

interface FolderProps {
  project: Project;
  folder: Folder;
  /** indent of the folder row */
  depth?: number;
  expanded: Set<string>;
  toggle: (k: string, v?: boolean) => void;
  filter: 'all' | 'sessions';
  onNewSession: (x: number, y: number) => void;
}

function FolderNode({ folder, depth = 20, expanded, toggle, filter, onNewSession }: FolderProps): JSX.Element {
  const key = `f:${folder.id}`;
  const open = expanded.has(key);
  const changed = useStore((s) => s.changed.get(folder.path));

  useEffect(() => {
    if (open && filter === 'all') requestList(folder.path);
    if (open) requestChanged(folder.path);
  }, [open, filter, folder.path]);

  const gitMap = useMemo(() => {
    const m = new Map<string, FsEntry['gitStatus']>();
    for (const e of changed ?? []) m.set(e.path, e.gitStatus);
    return m;
  }, [changed]);

  return (
    <div>
      <div
        className="tree-row"
        style={{ paddingLeft: depth }}
        onClick={() => toggle(key)}
        onContextMenu={(e) => {
          e.preventDefault();
          onNewSession(e.clientX, e.clientY);
        }}
        title={folder.path}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="ficon">▮</span>
        <span className="label">{folder.name}</span>
        <button
          className="icon-btn hover-act"
          title="New Session Here"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onNewSession(r.left, r.bottom + 2);
          }}
        >
          +
        </button>
        <button
          className="icon-btn hover-act"
          title="Import Claude Code Sessions — conversations started in VS Code or a terminal in this folder"
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().openImportClaude({ projectId: folder.projectId, folderId: folder.id });
          }}
        >
          ⇲
        </button>
        <button
          className="icon-btn hover-act"
          title="Remove Folder"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Remove folder "${folder.name}" from the project?`)) send({ type: 'folder.remove', id: folder.id });
          }}
        >
          ×
        </button>
      </div>
      {open && (
        <>
          {filter === 'all' && <DirChildren path={folder.path} cwd={folder.path} depth={depth + 20} expanded={expanded} toggle={toggle} gitMap={gitMap} />}
        </>
      )}
    </div>
  );
}

/* ---------- drag a session: reorder within its part, or drop it into another part / project ---------- */

const DRAG_TYPE = 'application/x-agento-session';

/** Drop target props for a project / part row: the session goes last in it. */
function dropInto(projectId: string): React.HTMLAttributes<HTMLDivElement> {
  return {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.currentTarget.classList.add('drop-into');
    },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop-into'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('drop-into');
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id) {
        e.preventDefault();
        send({ type: 'session.move', id, projectId });
      }
    }
  };
}

function SessionRow({ session: s, depth, folderName }: { session: Session; depth: number; folderName?: string }): JSX.Element {
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
      <span className="caret" />
      <span className={`status-dot ${s.status}`} />
      <AgentIcon kind={s.agent} color={s.color} />
      <span className="label" onDoubleClick={(e) => { e.stopPropagation(); void renameSession(s.id); }}>{displayTitle(s)}</span>
      {s.role !== 'player' && <span className={`role-tag ${s.role}`}>{roleLabel(s)}</span>}
      {folderName && <span className="muted tree-session-folder">{folderName}</span>}
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

interface DirProps {
  path: string;
  cwd: string;
  depth: number;
  expanded: Set<string>;
  toggle: (k: string, v?: boolean) => void;
  gitMap: Map<string, FsEntry['gitStatus']>;
}

function DirChildren({ path, cwd, depth, expanded, toggle, gitMap }: DirProps): JSX.Element {
  const entries = useStore((s) => s.fsLists.get(path));
  const openFileCard = useStore((s) => s.openFileCard);
  const openViewerTab = useStore((s) => s.openViewerTab);
  if (!entries) return <div className="tree-empty" style={{ paddingLeft: depth }}>Loading…</div>;
  const sorted = [...entries].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return (
    <>
      {sorted.map((e) =>
        e.isDir ? (
          <DirNode key={e.path} entry={e} cwd={cwd} depth={depth} expanded={expanded} toggle={toggle} gitMap={gitMap} />
        ) : (
          <FileRow key={e.path} entry={e} depth={depth} git={e.gitStatus ?? gitMap.get(e.path)} onClick={() => openFileCard(e.path, cwd)} onDouble={() => openViewerTab(e.path)} />
        )
      )}
    </>
  );
}

function DirNode({ entry, cwd, depth, expanded, toggle, gitMap }: Omit<DirProps, 'path'> & { entry: FsEntry }): JSX.Element {
  const key = `d:${entry.path}`;
  const open = expanded.has(key);
  useEffect(() => {
    if (open) requestList(entry.path);
  }, [open, entry.path]);
  return (
    <div>
      <div className="tree-row" style={{ paddingLeft: depth }} onClick={() => toggle(key)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="ficon">▸</span>
        <span className="label">{entry.name}</span>
      </div>
      {open && <DirChildren path={entry.path} cwd={cwd} depth={depth + 14} expanded={expanded} toggle={toggle} gitMap={gitMap} />}
    </div>
  );
}

function FileRow({ entry, depth, git, onClick, onDouble, showRelative }: { entry: FsEntry; depth: number; git?: FsEntry['gitStatus']; onClick: () => void; onDouble: () => void; showRelative?: string }): JSX.Element {
  const selectedPath = useStore((s) => {
    const c = s.selectedFileCardId ? s.fileCards.get(s.selectedFileCardId) : undefined;
    return c?.path;
  });
  let label = entry.name;
  if (showRelative && entry.path.startsWith(showRelative)) label = entry.path.slice(showRelative.length).replace(/^[\\/]/, '') || basename(entry.path);
  return (
    <div className={`tree-row ${selectedPath === entry.path ? 'selected' : ''}`} style={{ paddingLeft: depth }} onClick={onClick} onDoubleClick={onDouble} title={entry.path}>
      <span className="caret" />
      <span className="ficon mono">{fileIcon(entry.name)}</span>
      <span className="label">{label}</span>
      {git && <span className={`git ${git}`}>{git}</span>}
    </div>
  );
}

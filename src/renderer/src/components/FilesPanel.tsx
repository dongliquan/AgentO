import { useEffect, useState } from 'react';
import type { AgentKind, Folder, Project } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { useReveal } from '@/lib/fileRefs';
import { useTalkProject } from '@/lib/talkFilter';
import { AGENT_LABELS, pcStyle, projectColor } from '@/lib/format';
import { AgentPicker } from './AgentPicker';
import { FolderTree, leafFolders, useExpanded } from './FileTree';

const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\');

/** The project (not a part) a project id belongs to. */
function rootOf(projects: Project[], id: string | undefined): Project | undefined {
  const p = id ? projects.find((x) => x.id === id) : undefined;
  if (!p) return undefined;
  return p.parentId ? projects.find((x) => x.id === p.parentId) ?? p : p;
}

/**
 * Files tab: the folders of the selected session's project as a file tree (parts work in their project's folders).
 * Follows the selection like the project filter; a file revealed from a chat ("Show in Files", a click on a file name)
 * switches to that file's project until another session is picked.
 */
export function FilesPanel(): JSX.Element {
  const projects = useStore((s) => s.projects);
  const selectedId = useStore((s) => s.selectedId);
  const selProjectId = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId)?.projectId : undefined));
  const talk = useTalkProject((s) => s.project);
  const revealNonce = useReveal((s) => s.nonce);
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => setRevealed(null), [selectedId]);
  const project = rootOf(projects, revealed ?? undefined) ?? rootOf(projects, selProjectId) ?? rootOf(projects, talk) ?? projects.find((p) => !p.parentId && !p.closed);
  const [expanded, toggle] = useExpanded();
  // a project's folders open by default (once each)
  useEffect(() => {
    for (const f of project?.folders ?? []) if (!expanded.has(`f!:${f.id}`)) {
      toggle(`f:${f.id}`, true);
      toggle(`f!:${f.id}`, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);
  // reveal: the project that holds the file, its folder and every subfolder down to the file, scrolled into view
  useEffect(() => {
    const target = useReveal.getState().path;
    if (!target) return;
    const low = norm(target);
    let best: { project: Project; folder: Folder } | undefined;
    for (const p of projects.filter((x) => !x.parentId && !x.closed)) {
      for (const f of p.folders) {
        const fp = norm(f.path);
        if (low.startsWith(fp + '\\') && (!best || fp.length > norm(best.folder.path).length)) best = { project: p, folder: f };
      }
    }
    if (!best) return;
    setRevealed(best.project.id);
    toggle(`f:${best.folder.id}`, true);
    let cur = best.folder.path.replace(/[\\/]+$/, '');
    for (const seg of target.replace(/\//g, '\\').slice(cur.length + 1).split('\\').slice(0, -1)) {
      cur = `${cur}\\${seg}`;
      toggle(`d:${cur}`, true);
    }
    // the directories load as they open: look for the row a few times, then scroll to it
    let tries = 0;
    const find = (): void => {
      const row = document.querySelector(`.files-tree .tree-row[data-path="${CSS.escape(low)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
      else if (++tries < 20) setTimeout(find, 250);
    };
    setTimeout(find, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);
  const [picker, setPicker] = useState<{ x: number; y: number; folder: Folder } | null>(null);
  const openNewSession = useStore((s) => s.openNewSession);

  if (!project) return <div className="rp-body muted dock-empty">No open project. Create one in the sidebar with +.</div>;
  const folders = leafFolders(project.folders);
  const pick = (agent: AgentKind): void => {
    if (!picker) return;
    send({ type: 'session.create', projectId: project.id, folderId: picker.folder.id, agent, title: `${AGENT_LABELS[agent]} · ${picker.folder.name}`, cols: 100, rows: 30 });
    setPicker(null);
  };
  return (
    <div className="files-panel" style={pcStyle(projectColor(project.id, projects))}>
      <div className="files-head" title={project.folders.map((f) => f.path).join('\n')}>
        <span className="pc-dot" />
        <span className="label ellipsis">{project.name}</span>
        <span className="muted">{folders.length} folder{folders.length === 1 ? '' : 's'}</span>
        <button
          className="icon-btn"
          title="Add Folder to the project"
          onClick={() => {
            void window.desktop.pickFolder().then((path) => {
              if (path) send({ type: 'folder.add', projectId: project.id, path });
            });
          }}
        >
          +
        </button>
      </div>
      <div className="tree files-tree">
        {folders.length === 0 && <div className="tree-empty">No folders yet. Add one with + above.</div>}
        {folders.map((f) => (
          <FolderTree key={f.id} folder={f} expanded={expanded} toggle={toggle} onNewSession={(x, y) => setPicker({ x, y, folder: f })} />
        ))}
      </div>
      {picker && (
        <AgentPicker
          x={picker.x}
          y={picker.y}
          onPick={pick}
          onMore={() => {
            openNewSession({ projectId: project.id, folderId: picker.folder.id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

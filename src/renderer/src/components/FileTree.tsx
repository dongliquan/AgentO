import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Folder, FsEntry } from '@shared/protocol';
import { useStore } from '@/store';
import { requestChanged, requestList, send } from '@/client';
import { openFile } from '@/lib/openfile';
import { useReveal } from '@/lib/fileRefs';
import { basename } from '@/lib/format';
import { FileIcon } from './FileIcon';
import { copyPath, usePathMenu } from './PathMenu';

/** The file tree of a project's folders (the Files tab): folder rows, directories that load as they open, file rows. */

export function useExpanded(): [Set<string>, (key: string, v?: boolean) => void] {
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

interface FolderProps {
  folder: Folder;
  /** indent of the folder row */
  depth?: number;
  expanded: Set<string>;
  toggle: (k: string, v?: boolean) => void;
  onNewSession: (x: number, y: number) => void;
}

export function FolderTree({ folder, depth = 6, expanded, toggle, onNewSession }: FolderProps): JSX.Element {
  const key = `f:${folder.id}`;
  const open = expanded.has(key);
  const changed = useStore((s) => s.changed.get(folder.path));

  useEffect(() => {
    if (open) {
      requestList(folder.path);
      requestChanged(folder.path);
    }
  }, [open, folder.path]);

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
        <FolderIcon open={false} />
        <span className="label">{shortPath(folder.path)}</span>
        <button
          className="icon-btn hover-act"
          title="Copy Path"
          onClick={(e) => {
            e.stopPropagation();
            copyPath(folder.path, 'Path');
          }}
        >
          ⧉
        </button>
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
      {open && <DirChildren path={folder.path} cwd={folder.path} depth={depth + 14} expanded={expanded} toggle={toggle} gitMap={gitMap} />}
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
  if (!entries) return <div className="tree-empty" style={{ paddingLeft: depth }}>Loading…</div>;
  const sorted = [...entries].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return (
    <>
      {sorted.map((e) =>
        e.isDir ? (
          <DirNode key={e.path} entry={e} cwd={cwd} depth={depth} expanded={expanded} toggle={toggle} gitMap={gitMap} />
        ) : (
          <FileRow key={e.path} entry={e} depth={depth} git={e.gitStatus ?? gitMap.get(e.path)} onClick={() => openFile(e.path, cwd)} base={cwd} />
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
      <div
        className="tree-row"
        style={{ paddingLeft: depth }}
        onClick={() => toggle(key)}
        onContextMenu={(e) => {
          e.preventDefault();
          usePathMenu.getState().show({ x: e.clientX, y: e.clientY, path: entry.path, base: cwd, isDir: true });
        }}
        title={`${entry.path}
Right-click: copy path`}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <FolderIcon open={open} />
        <span className="label">{entry.name}</span>
        <button
          className="icon-btn hover-act"
          title="Copy Path"
          onClick={(e) => {
            e.stopPropagation();
            copyPath(entry.path, 'Path');
          }}
        >
          ⧉
        </button>
      </div>
      {open && <DirChildren path={entry.path} cwd={cwd} depth={depth + 14} expanded={expanded} toggle={toggle} gitMap={gitMap} />}
    </div>
  );
}

function FileRow({ entry, depth, git, onClick, onDouble, showRelative, base }: { entry: FsEntry; depth: number; git?: FsEntry['gitStatus']; onClick: () => void; onDouble?: () => void; showRelative?: string; base?: string }): JSX.Element {
  const cardPath = useStore((s) => {
    const c = s.selectedFileCardId ? s.fileCards.get(s.selectedFileCardId) : undefined;
    return c?.path;
  });
  const revealedHere = useReveal((s) => !!s.path && s.path.toLowerCase() === entry.path.toLowerCase());
  const selectedPath = revealedHere ? entry.path : cardPath;
  let label = entry.name;
  if (showRelative && entry.path.startsWith(showRelative)) label = entry.path.slice(showRelative.length).replace(/^[\\/]/, '') || basename(entry.path);
  return (
    <div
      className={`tree-row ${selectedPath === entry.path ? 'selected' : ''}`}
      data-path={entry.path.toLowerCase()}
      style={{ paddingLeft: depth }}
      onClick={onClick}
      onDoubleClick={onDouble}
      onContextMenu={(e) => {
        e.preventDefault();
        usePathMenu.getState().show({ x: e.clientX, y: e.clientY, path: entry.path, base: base ?? showRelative ?? '', isDir: false });
      }}
      title={`${entry.path}
Right-click: copy path`}
    >
      <span className="caret" />
      <FileIcon name={entry.name} />
      <span className="label">{label}</span>
      {git && <span className={`git ${git}`}>{git}</span>}
      <button
        className="icon-btn hover-act"
        title="Copy Path"
        onClick={(e) => {
          e.stopPropagation();
          copyPath(entry.path, 'Path');
        }}
      >
        ⧉
      </button>
    </div>
  );
}

function FolderIcon({ open }: { open: boolean }): JSX.Element {
  // ReadO's folder: filled, the open one with its flap lifted
  return (
    <svg className="ficon folder-ico" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      {open ? (
        <path d="M1.5 3.5h4.2l1.4 1.5h7.4v2h-10l-1.6 6.5h-1.4zM3.3 8h12l-1.6 5.5h-12z" fill="#e8b04a" stroke="#c9902a" strokeWidth=".8" strokeLinejoin="round" />
      ) : (
        <path d="M1.5 3.5h4.2l1.4 1.5h7.4v8.5h-13z" fill="#e8b04a" stroke="#c9902a" strokeWidth=".8" />
      )}
    </svg>
  );
}

const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase().replace(/\//g, '\\');

/**
 * The folders a project / part actually works in: a folder that contains another of its folders is left out, so a
 * parent and its subfolder never sit side by side at one level.
 */
export function leafFolders(folders: Folder[]): Folder[] {
  return folders.filter((f) => !folders.some((o) => o !== f && norm(o.path).startsWith(norm(f.path) + '\\')));
}

/** A folder's last two path parts ("work\shop-web"): where it sits, not just its name. */
function shortPath(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('\\') || p;
}

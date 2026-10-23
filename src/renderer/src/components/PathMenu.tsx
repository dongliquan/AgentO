import { create } from 'zustand';
import { openFile, openInReadO } from '@/lib/openfile';
import { useToasts } from '@/lib/notify';
import { copyText } from '@/lib/search';
import { basename, normPath } from '@/lib/format';
import { useEscape } from '@/lib/hooks';

interface At {
  x: number;
  y: number;
  path: string;
  /** the folder the tree row belongs to: Copy Relative Path is relative to it */
  base: string;
  isDir: boolean;
}

/** Right-click menu of a file or folder in the sidebar tree: copy its path (absolute / relative / name), open it. */
export const usePathMenu = create<{ at: At | null; show: (at: At) => void; hide: () => void }>((set) => ({
  at: null,
  show: (at) => set({ at }),
  hide: () => set({ at: null })
}));

/** Copy a path (or name) and say so in a toast. */
export function copyPath(text: string, what: string): void {
  copyText(text).then(
    () => useToasts.getState().push({ title: `${what} copied`, body: text }),
    () => useToasts.getState().push({ title: 'Could not copy', body: text })
  );
}

const relative = (path: string, base: string): string => {
  const b = normPath(base);
  return b && normPath(path).startsWith(b + '\\') ? path.slice(base.replace(/[\\/]+$/, '').length + 1) : path;
};

export function PathMenu(): JSX.Element | null {
  const at = usePathMenu((s) => s.at);
  const hide = usePathMenu((s) => s.hide);
  useEscape(!!at, hide);
  if (!at) return null;
  const name = basename(at.path);
  const act = (fn: () => void) => (): void => {
    fn();
    hide();
  };
  return (
    <>
      <div className="fileref-scrim" onMouseDown={hide} onContextMenu={(e) => { e.preventDefault(); hide(); }} />
      <div className="popover fileref-menu" style={{ left: Math.min(at.x, window.innerWidth - 260), top: Math.min(at.y + 4, window.innerHeight - 200) }}>
        <div className="fileref-path muted ellipsis" title={at.path}>{at.path}</div>
        {!at.isDir && <button className="item" onClick={act(() => openFile(at.path, at.base))}>Open</button>}
        {!at.isDir && <button className="item" onClick={act(() => openInReadO(at.path))} title="For a closer look: edit, search, git">Open in ReadO</button>}
        <button className="item" onClick={act(() => copyPath(at.path, 'Path'))}>Copy Path</button>
        <button className="item" onClick={act(() => copyPath(relative(at.path, at.base), 'Relative path'))}>Copy Relative Path</button>
        <button className="item" onClick={act(() => copyPath(name, 'Name'))}>Copy Name</button>
      </div>
    </>
  );
}

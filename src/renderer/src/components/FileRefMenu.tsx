import { useEffect, useState } from 'react';
import { resolveFileRef, useFileRefMenu, useReveal } from '@/lib/fileRefs';
import { openFile } from '@/lib/openfile';

/**
 * File names in chats and reports (`status-report.md`, `src/a.ts:12`, links to local files) are clickable: this menu
 * opens the file, shows it in the sidebar, or copies its path. Mounted once per window; clicks are caught globally.
 */
export function FileRefMenu(): JSX.Element | null {
  const at = useFileRefMenu((s) => s.at);
  const hide = useFileRefMenu((s) => s.hide);
  const [path, setPath] = useState<string | null | undefined>(undefined);

  // a click on any file reference opens the menu there
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('.file-ref') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const cwd = (el.closest('[data-cwd]') as HTMLElement | null)?.dataset['cwd'];
      useFileRefMenu.getState().show({ x: e.clientX, y: e.clientY, ref: el.dataset['file'] ?? el.textContent ?? '', ...(cwd ? { cwd } : {}) });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    setPath(undefined);
    if (!at) return;
    let live = true;
    void resolveFileRef(at.ref, at.cwd).then((p) => live && setPath(p));
    return () => {
      live = false;
    };
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, hide]);
  if (!at) return null;

  const left = Math.min(at.x, window.innerWidth - 260);
  const top = Math.min(at.y + 6, window.innerHeight - 140);
  const act = (fn: (p: string) => void) => (): void => {
    if (path) fn(path);
    hide();
  };
  return (
    <>
      <div className="fileref-scrim" onMouseDown={hide} />
      <div className="popover fileref-menu" style={{ left, top }}>
        <div className="fileref-path muted ellipsis" title={path ?? at.ref}>
          {path === undefined ? 'Finding the file…' : path === null ? `Not found in the open projects: ${at.ref}` : path}
        </div>
        <button className="item" disabled={!path} onClick={act((p) => openFile(p, at.cwd ?? ''))}>Open</button>
        <button className="item" disabled={!path} onClick={act((p) => useReveal.getState().reveal(p))}>Show in sidebar</button>
        <button className="item" disabled={!path} onClick={act((p) => void navigator.clipboard.writeText(p))}>Copy path</button>
      </div>
    </>
  );
}

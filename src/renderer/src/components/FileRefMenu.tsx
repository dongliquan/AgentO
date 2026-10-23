import { useEffect, useState } from 'react';
import { resolveFileRef, useFileRefMenu, useReveal } from '@/lib/fileRefs';
import { openFile, openInReadO } from '@/lib/openfile';
import { useEscape } from '@/lib/hooks';
import { useToasts } from '@/lib/notify';
import { copyPath } from './PathMenu';

/**
 * File names in chats and reports (`status-report.md`, `src/a.ts:12`, links to local files) are clickable: a click shows
 * the file in the Files tab, a double-click opens it, a right-click opens this menu (Open · Open in ReadO · Show in Files · Copy path).
 * Mounted once per window; the events are caught globally.
 */
export function FileRefMenu(): JSX.Element | null {
  const at = useFileRefMenu((s) => s.at);
  const hide = useFileRefMenu((s) => s.hide);
  const [path, setPath] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const refOf = (e: MouseEvent): { el: HTMLElement; ref: string; cwd?: string } | null => {
      const el = (e.target as HTMLElement | null)?.closest?.('.file-ref') as HTMLElement | null;
      if (!el) return null;
      e.preventDefault();
      e.stopPropagation();
      const cwd = (el.closest('[data-cwd]') as HTMLElement | null)?.dataset['cwd'];
      return { el, ref: el.dataset['file'] ?? el.textContent ?? '', ...(cwd ? { cwd } : {}) };
    };
    const found = (r: { ref: string; cwd?: string }, fn: (p: string) => void): void => {
      void resolveFileRef(r.ref, r.cwd).then((p) => {
        if (p) fn(p);
        else useToasts.getState().push({ title: 'Not found in the open projects', body: r.ref });
      });
    };
    // click: select it in the Files tab · double-click: open it · right-click: the menu
    const onClick = (e: MouseEvent): void => {
      const r = refOf(e);
      if (r && e.detail < 2) found(r, (p) => useReveal.getState().reveal(p));
    };
    const onDouble = (e: MouseEvent): void => {
      const r = refOf(e);
      if (r) found(r, (p) => openFile(p, r.cwd ?? ''));
    };
    const onMenu = (e: MouseEvent): void => {
      const r = refOf(e);
      if (r) useFileRefMenu.getState().show({ x: e.clientX, y: e.clientY, ref: r.ref, ...(r.cwd ? { cwd: r.cwd } : {}) });
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDouble, true);
    document.addEventListener('contextmenu', onMenu, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDouble, true);
      document.removeEventListener('contextmenu', onMenu, true);
    };
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
  useEscape(!!at, hide);
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
        <button className="item" disabled={!path} onClick={act((p) => openInReadO(p))} title="For a closer look: edit, search, git">Open in ReadO</button>
        <button className="item" disabled={!path} onClick={act((p) => useReveal.getState().reveal(p))}>Show in Files</button>
        <button className="item" disabled={!path} onClick={act((p) => copyPath(p, 'Path'))}>Copy path</button>
      </div>
    </>
  );
}

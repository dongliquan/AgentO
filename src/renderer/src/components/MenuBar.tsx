import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuNode } from '@shared/protocol';

/**
 * The app menu (Windows/Linux): one button in the title row instead of a menu bar — File, Edit, View … open as
 * submenus of one dropdown. Native popup menus always reserve a wide check-mark gutter and ignore the app theme, so the
 * dropdowns are drawn here; a click runs the native item by its index path (roles, checkboxes and accelerators keep
 * working through the real application menu, and so do Alt+letter shortcuts).
 */
export function MenuBar(): JSX.Element | null {
  const [tree, setTree] = useState<MenuNode[]>([]);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    void window.desktop?.menuTree?.().then(setTree);
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || [...document.querySelectorAll('.menu-dropdown')].some((d) => d.contains(t))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onBlur = (): void => setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  if (tree.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        className={`app-menu-btn ${open ? 'open' : ''}`}
        title="Menu"
        aria-label="Menu"
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          if (open) {
            setOpen(false);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom + 4 });
          refresh(); // current checkbox states
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          // the top-level menus as submenus of one list; Dropdown paths start at the top-level index
          <Dropdown items={tree.map((m) => ({ ...m, type: 'submenu' as const }))} path={[]} x={anchor.x} y={anchor.y} onDone={() => setOpen(false)} />,
          document.body
        )}
    </>
  );
}

function Dropdown({ items, path, x, y, onDone }: { items: MenuNode[]; path: number[]; x: number; y: number; onDone: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const [pos, setPos] = useState({ x, y });

  // keep the dropdown on screen
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);

  return (
    <div className="menu-dropdown" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.type === 'separator') return <div key={i} className="menu-sep" />;
        const isSub = it.type === 'submenu';
        return (
          <button
            key={i}
            className={`menu-row ${isSub && sub?.index === i ? 'open' : ''}`}
            disabled={!it.enabled}
            onMouseEnter={(e) => {
              if (isSub) {
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, x: r.right - 2, y: r.top - 4 });
              } else setSub(null);
            }}
            onClick={() => {
              if (isSub || !it.enabled) return;
              window.desktop.menuClick([...path, i]);
              onDone();
            }}
          >
            <span className="menu-label">{it.label}</span>
            {it.checked && <span className="menu-check">✓</span>}
            {it.accelerator && <span className="menu-acc">{it.accelerator}</span>}
            {isSub && <span className="menu-arrow">›</span>}
          </button>
        );
      })}
      {sub && items[sub.index]?.items && <Dropdown items={items[sub.index]!.items!} path={[...path, sub.index]} x={sub.x} y={sub.y} onDone={onDone} />}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuNode } from '@shared/protocol';

/**
 * In-app menu bar (Windows/Linux). Native popup menus always reserve a wide check-mark gutter and ignore the app
 * theme, so the dropdowns are drawn here; a click runs the native item by its index path (roles, checkboxes and
 * accelerators keep working through the real application menu).
 */
export function MenuBar(): JSX.Element | null {
  const [tree, setTree] = useState<MenuNode[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const navRef = useRef<HTMLElement>(null);

  const refresh = useCallback(() => {
    void window.desktop?.menuTree?.().then(setTree);
  }, []);
  useEffect(refresh, [refresh]);

  const openAt = (i: number, el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.bottom + 2 });
    setOpen(i);
    refresh(); // current checkbox states
  };

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (navRef.current?.contains(t) || document.querySelector('.menu-dropdown')?.contains(t)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    const onBlur = (): void => setOpen(null);
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
  const menu = open !== null ? tree[open] : undefined;

  return (
    <nav className="menubar" ref={navRef}>
      {tree.map((m, i) => (
        <button
          key={m.label}
          className={`menubar-item ${open === i ? 'open' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            if (open === i) setOpen(null);
            else openAt(i, e.currentTarget);
          }}
          onMouseEnter={(e) => {
            if (open !== null && open !== i) openAt(i, e.currentTarget);
          }}
        >
          {m.label}
        </button>
      ))}
      {menu?.items &&
        createPortal(
          <Dropdown items={menu.items} path={[open as number]} x={anchor.x} y={anchor.y} onDone={() => setOpen(null)} />,
          document.body
        )}
    </nav>
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

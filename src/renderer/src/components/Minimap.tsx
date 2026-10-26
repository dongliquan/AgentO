import type React from 'react';
import { useStore } from '@/store';
import { useClosedSessionIds } from '@/lib/closed';
import { pcStyle, projectColor } from '@/lib/format';

const W = 160;
const H = 100;

const STATUS_COLOR: Record<string, string> = {
  starting: '#4fa3ff',
  working: '#3fb950',
  waiting: '#e5a50a',
  done: '#6a6a70',
  error: '#e06c75',
  hibernated: '#48484d'
};

export function Minimap({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }): JSX.Element | null {
  const sessions = useStore((s) => s.sessions);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const setPan = useStore((s) => s.setPan);
  const closed = useClosedSessionIds();
  const projects = useStore((s) => s.projects);

  const items = [
    ...[...sessions.values()].filter((s) => !closed.has(s.id)).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, color: STATUS_COLOR[s.status] ?? '#666' }))
  ];
  if (items.length === 0) return null;
  // one frame per project (parts included) around its cards, in the project's colour, so projects read apart
  const areas = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  // and one lighter frame per part inside it
  const partAreas = new Map<string, { root: string; x0: number; y0: number; x1: number; y1: number }>();
  for (const s of sessions.values()) {
    if (closed.has(s.id) || !s.projectId) continue;
    const p = projects.find((x) => x.id === s.projectId);
    const root = p?.parentId ?? p?.id ?? s.projectId;
    const a = areas.get(root) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    areas.set(root, { x0: Math.min(a.x0, s.x), y0: Math.min(a.y0, s.y), x1: Math.max(a.x1, s.x + s.w), y1: Math.max(a.y1, s.y + s.h) });
    if (p?.parentId) {
      const b = partAreas.get(p.id) ?? { root, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      partAreas.set(p.id, { root, x0: Math.min(b.x0, s.x), y0: Math.min(b.y0, s.y), x1: Math.max(b.x1, s.x + s.w), y1: Math.max(b.y1, s.y + s.h) });
    }
  }

  const el = containerRef.current;
  const vw = el ? el.clientWidth / zoom : 0;
  const vh = el ? el.clientHeight / zoom : 0;
  const vx = -panX / zoom;
  const vy = -panY / zoom;

  let minX = vx, minY = vy, maxX = vx + vw, maxY = vy + vh;
  for (const it of items) {
    minX = Math.min(minX, it.x);
    minY = Math.min(minY, it.y);
    maxX = Math.max(maxX, it.x + it.w);
    maxY = Math.max(maxY, it.y + it.h);
  }
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
  const offX = (W - (maxX - minX) * scale) / 2;
  const offY = (H - (maxY - minY) * scale) / 2;
  const tx = (x: number): number => offX + (x - minX) * scale;
  const ty = (y: number): number => offY + (y - minY) * scale;

  const onClick = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = (e.clientX - r.left - offX) / scale + minX;
    const cy = (e.clientY - r.top - offY) / scale + minY;
    if (!el) return;
    setPan(el.clientWidth / 2 - cx * zoom, el.clientHeight / 2 - cy * zoom);
  };

  return (
    <div className="minimap" onClick={onClick} onPointerDown={(e) => e.stopPropagation()} title="Click to navigate">
      {[...areas].map(([id, a]) => (
        <div
          key={id}
          className="mm-project"
          title={projects.find((p) => p.id === id)?.name}
          style={{ ...pcStyle(projectColor(id, projects)), left: tx(a.x0) - 3, top: ty(a.y0) - 3, width: (a.x1 - a.x0) * scale + 6, height: (a.y1 - a.y0) * scale + 6 }}
        />
      ))}
      {[...partAreas].map(([id, a]) => (
        <div
          key={id}
          className="mm-part"
          title={projects.find((p) => p.id === id)?.name}
          style={{ ...pcStyle(projectColor(a.root, projects)), left: tx(a.x0) - 1.5, top: ty(a.y0) - 1.5, width: (a.x1 - a.x0) * scale + 3, height: (a.y1 - a.y0) * scale + 3 }}
        />
      ))}
      {items.map((it, i) => (
        <div key={i} className="mm-rect" style={{ left: tx(it.x), top: ty(it.y), width: Math.max(2, it.w * scale), height: Math.max(2, it.h * scale), background: it.color }} />
      ))}
      <div className="mm-view" style={{ left: tx(vx), top: ty(vy), width: vw * scale, height: vh * scale }} />
    </div>
  );
}

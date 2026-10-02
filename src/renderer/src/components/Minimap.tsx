import type React from 'react';
import { useStore } from '@/store';
import { useClosedSessionIds } from '@/lib/closed';

const W = 160;
const H = 100;

const STATUS_COLOR: Record<string, string> = {
  starting: '#4fa3ff',
  working: '#3fb950',
  waiting: '#e5a50a',
  done: '#6a6a70',
  error: '#f85149',
  hibernated: '#48484d'
};

export function Minimap({ containerRef }: { containerRef: React.RefObject<HTMLDivElement> }): JSX.Element | null {
  const sessions = useStore((s) => s.sessions);
  const fileCards = useStore((s) => s.fileCards);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const setPan = useStore((s) => s.setPan);
  const closed = useClosedSessionIds();

  const items = [
    ...[...sessions.values()].filter((s) => !closed.has(s.id)).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, color: STATUS_COLOR[s.status] ?? '#666' })),
    ...[...fileCards.values()].map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, color: '#4fa3ff' }))
  ];
  if (items.length === 0) return null;

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
      {items.map((it, i) => (
        <div key={i} className="mm-rect" style={{ left: tx(it.x), top: ty(it.y), width: Math.max(2, it.w * scale), height: Math.max(2, it.h * scale), background: it.color }} />
      ))}
      <div className="mm-view" style={{ left: tx(vx), top: ty(vy), width: vw * scale, height: vh * scale }} />
    </div>
  );
}

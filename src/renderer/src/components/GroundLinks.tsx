import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamFeedItem } from './TeamFeedItem';
import { offGround, shownRect, type GroupLayout, type Rect } from '@/lib/groups';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useNow } from '@/lib/hooks';

/** A message counts as "just exchanged" (animated) for this long. */
const ACTIVE_MS = 90_000;

interface Link {
  key: string;
  a: Session;
  b: Session;
  /** latest message on this pair */
  last: InboxItem;
  count: number;
}

/** Point where the segment from the rect's center toward (tx, ty) leaves the rect. */
function edgePoint(s: Rect, tx: number, ty: number): [number, number] {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const k = Math.min(dx !== 0 ? s.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? s.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

/**
 * Lines between sessions that exchanged directives or reports (inbox items with a session sender).
 * Every pair that has talked gets a faint line; a pair active in the last 90 s gets a flowing dashed line pointing
 * from the latest sender to its receiver (blue = directive, pink = report). Drawn under the cards, in canvas units.
 */
function GroundLinksImpl({ layout }: { layout: GroupLayout }): JSX.Element | null {
  const sessions = useStore((s) => s.sessions);
  const inbox = useStore((s) => s.inbox);
  const now = useNow(5000);
  const [open, setOpen] = useState<{ a: string; b: string; x: number; y: number } | null>(null);

  const links = useMemo(() => {
    const map = new Map<string, Link>();
    for (const it of inbox) {
      if ((it.kind !== 'directive' && it.kind !== 'report') || !it.fromId || it.fromId === it.sessionId) continue;
      const from = sessions.get(it.fromId);
      const to = sessions.get(it.sessionId);
      if (!from || !to) continue;
      const key = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
      const cur = map.get(key);
      if (!cur) map.set(key, { key, a: from, b: to, last: it, count: 1 });
      else {
        cur.count++;
        if (it.createdAt > cur.last.createdAt) cur.last = it;
      }
    }
    return [...map.values()];
  }, [inbox, sessions]);

  if (links.length === 0 && !open) return null;

  return (
    <>
    <svg className="ground-links" width="1" height="1" aria-hidden="true">
      <defs>
        <marker id="gl-arrow-directive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="gl-head directive" />
        </marker>
        <marker id="gl-arrow-report" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="gl-head report" />
        </marker>
      </defs>
      {links.map((l) => {
        // orient the line from the latest sender to its receiver; a card hidden in a collapsed group links to its box
        const fromS = l.last.fromId === l.a.id ? l.a : l.b;
        const toS = fromS === l.a ? l.b : l.a;
        if (offGround(fromS.id, layout) || offGround(toS.id, layout)) return null; // a closed project
        const ga = layout.hidden.get(fromS.id);
        if (ga && ga === layout.hidden.get(toS.id)) return null; // both inside the same collapsed group
        const from = shownRect(fromS, layout);
        const to = shownRect(toS, layout);
        // arc the line (bulging up/left of the direction of travel) so it clears cards sitting between the two
        const fx = from.x + from.w / 2;
        const fy = from.y + from.h / 2;
        const tx = to.x + to.w / 2;
        const ty = to.y + to.h / 2;
        const dist = Math.hypot(tx - fx, ty - fy) || 1;
        const bend = Math.min(220, dist * 0.35);
        const sign = fromS.id < toS.id ? 1 : -1; // same pair bends the same way whichever side spoke last
        const cx = (fx + tx) / 2 + ((ty - fy) / dist) * bend * sign;
        const cy = (fy + ty) / 2 - ((tx - fx) / dist) * bend * sign;
        const [x1, y1] = edgePoint(from, cx, cy);
        const [x2, y2] = edgePoint(to, cx, cy);
        const d = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
        const active = now - l.last.createdAt < ACTIVE_MS;
        const kind = l.last.kind === 'report' ? 'report' : 'directive';
        return (
          <g key={l.key}>
            <title>{`${fromS.title} → ${toS.title} · ${l.count} message${l.count > 1 ? 's' : ''}`}</title>
            <path className="gl-base" d={d} />
            <path
              className="gl-hit"
              d={d}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => setOpen({ a: l.a.id, b: l.b.id, x: e.clientX, y: e.clientY })}
            />
            {active && <path className={`gl-flow ${kind}`} d={d} markerEnd={`url(#gl-arrow-${kind})`} />}
          </g>
        );
      })}
    </svg>
      {open && createPortal(<LinkMessages a={open.a} b={open.b} x={open.x} y={open.y} onClose={() => setOpen(null)} />, document.body)}
    </>
  );
}

/** The messages two sessions exchanged (both directions, oldest first) — opened by clicking their link. */
function LinkMessages({ a, b, x, y, onClose }: { a: string; b: string; x: number; y: number; onClose: () => void }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const inbox = useStore((s) => s.inbox);
  const now = useNow(15000);
  const items = inbox
    .filter((it) => (it.kind === 'directive' || it.kind === 'report') && ((it.fromId === a && it.sessionId === b) || (it.fromId === b && it.sessionId === a)))
    .sort((p, q) => p.createdAt - q.createdAt)
    .slice(-40);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.link-messages')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);
  const left = Math.min(x + 12, window.innerWidth - 440);
  const top = Math.min(y + 12, window.innerHeight - 420);
  return (
    <div className="link-messages" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
      <div className="link-messages-head">
        <b>{sessions.get(a)?.title ?? '?'}</b>
        <span className="muted">⇄</span>
        <b>{sessions.get(b)?.title ?? '?'}</b>
        <span className="grow" />
        <span className="muted">{items.length} message{items.length === 1 ? '' : 's'}</span>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">×</button>
      </div>
      <div className="feed-list">
        {items.map((it) => (
          <TeamFeedItem key={it.id} item={it} sessions={sessions} now={now} />
        ))}
      </div>
    </div>
  );
}

/** Re-renders only when its own props change — not on every pan / zoom frame of the Ground. */
export const GroundLinks = memo(GroundLinksImpl);

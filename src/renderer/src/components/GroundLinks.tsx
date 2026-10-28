import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TeamFeedItem } from './TeamFeedItem';
import { offGround, shownRect, type GroupLayout, type Rect } from '@/lib/groups';
import { useDelegations } from './Delegations';
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
/**
 * An arrowhead at the end of a link, laid on the curve itself: its base is the point of the curve one head-length
 * before the end, so it follows the line even where the curve bends hard near a card (the end tangent alone points off
 * the visible line there). A polygon rather than an SVG marker, which drifts off a non-scaling stroke when zoomed.
 */
function arrowHead(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, scale: number): string {
  const l = 13 * scale; // length, on-screen px
  const w = 5 * scale; // half width
  // the curve's length, roughly (between the chord and the control polygon), and the point one head-length back
  const len = (Math.hypot(x2 - x1, y2 - y1) + Math.hypot(cx - x1, cy - y1) + Math.hypot(x2 - cx, y2 - cy)) / 2 || 1;
  const t = Math.max(0, 1 - l / len);
  const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
  const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
  const d = Math.hypot(x2 - bx, y2 - by) || 1;
  const ux = (x2 - bx) / d;
  const uy = (y2 - by) / d;
  const px = x2 - ux * l;
  const py = y2 - uy * l;
  return `${x2},${y2} ${px - uy * w},${py + ux * w} ${px + uy * w},${py - ux * w}`;
}

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
  // the arrowheads keep one on-screen size at any zoom (the lines do too: non-scaling strokes); the zoom is taken in
  // steps so a zoom gesture does not re-render the links every frame
  const scale = useStore((s) => 1 / 2 ** (Math.round(Math.log2(s.zoom) * 4) / 4));
  const sessions = useStore((s) => s.sessions);
  const inbox = useStore((s) => s.inbox);
  const now = useNow(5000);
  const delegations = useDelegations((s) => s.byCoach);
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
  // arrowheads of the active links, drawn above the cards (the lines stay under them): a head right at a card's edge
  // must not disappear under the card, its border or its shadow
  const heads: { key: string; kind: string; points: string }[] = [];

  return (
    <>
    <svg className="ground-links" width="1" height="1" aria-hidden="true">
      {links.map((l) => {
        // orient the line from the latest sender to its receiver; a card hidden in a collapsed group links to its box
        const handFrom = delegations.get(l.a.id)?.some((d) => d.target === l.b.id) ? l.a : delegations.get(l.b.id)?.some((d) => d.target === l.a.id) ? l.b : undefined;
        const fromS = now - l.last.createdAt >= ACTIVE_MS && handFrom ? handFrom : l.last.fromId === l.a.id ? l.a : l.b;
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
        // a coordinator's hand-off with no report back yet stays shown: flowing while the player works, still otherwise
        const handOff = (delegations.get(l.a.id)?.some((d) => d.target === l.b.id) ? [l.a, l.b] : delegations.get(l.b.id)?.some((d) => d.target === l.a.id) ? [l.b, l.a] : null);
        const recent = now - l.last.createdAt < ACTIVE_MS;
        const active = recent || !!handOff;
        const held = !recent && !!handOff && handOff[1]!.status !== 'working' && handOff[1]!.status !== 'starting';
        const kind = recent ? (l.last.kind === 'report' ? 'report' : 'directive') : 'directive';
        if (active) heads.push({ key: l.key, kind, points: arrowHead(x1, y1, cx, cy, x2, y2, scale) });
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
            {active && <path className={`gl-flow ${kind} ${held ? 'held' : ''}`} d={d} />}
          </g>
        );
      })}
    </svg>
    {heads.length > 0 && (
      <svg className="ground-link-heads" width="1" height="1" aria-hidden="true">
        {heads.map((h) => <polygon key={h.key} className={`gl-head ${h.kind}`} points={h.points} />)}
      </svg>
    )}
      {open && createPortal(<LinkMessages a={open.a} b={open.b} x={open.x} y={open.y} onClose={() => setOpen(null)} />, document.body)}
    </>
  );
}

/** The messages two sessions exchanged (both directions, newest first) — opened by clicking their link. */
function LinkMessages({ a, b, x, y, onClose }: { a: string; b: string; x: number; y: number; onClose: () => void }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const inbox = useStore((s) => s.inbox);
  const now = useNow(15000);
  const items = inbox
    .filter((it) => (it.kind === 'directive' || it.kind === 'report') && ((it.fromId === a && it.sessionId === b) || (it.fromId === b && it.sessionId === a)))
    // newest first
    .sort((p, q) => q.createdAt - p.createdAt)
    .slice(0, 40);
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

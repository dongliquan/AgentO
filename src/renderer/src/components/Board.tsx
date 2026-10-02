import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useStore, ZOOM_MAX, ZOOM_MIN } from '@/store';
import { fitAll, newSessionFor, zoomBy } from '@/commands';
import { SessionCard } from './SessionCard';
import { FileCard } from './FileCard';
import { Minimap } from './Minimap';
import { GroundLinks } from './GroundLinks';
import { GroundGroups, useGroupLayout } from './GroundGroups';

const GRID = 24;

/**
 * Last pan request already applied. The Board unmounts while another view is shown (Focus mode, Split, Tabs); on
 * remount the store still holds the old request, and re-applying it would jump the view away from where it was left.
 */
let appliedPanNonce = 0;

/**
 * Pan / zoom updates coalesced to one store update per animation frame: pointer and wheel events come faster than
 * the screen redraws, and each store update re-renders the Ground.
 */
let pendingView: { zoom?: number; x: number; y: number } | null = null;
let viewFrame = 0;
function scheduleView(v: { zoom?: number; x: number; y: number }): void {
  pendingView = { ...pendingView, ...v };
  if (viewFrame) return;
  viewFrame = requestAnimationFrame(() => {
    viewFrame = 0;
    const v2 = pendingView;
    pendingView = null;
    if (!v2) return;
    const st = useStore.getState();
    if (v2.zoom !== undefined) st.setZoom(v2.zoom, v2.x, v2.y);
    else st.setPan(v2.x, v2.y);
  });
}
/** the view as it will be after the scheduled frame (wheel steps build on it, not on the stale store) */
function viewNow(): { zoom: number; x: number; y: number } {
  const st = useStore.getState();
  return { zoom: pendingView?.zoom ?? st.zoom, x: pendingView?.x ?? st.panX, y: pendingView?.y ?? st.panY };
}

/** Snap to whole device pixels: fractional translations blur text and 1px borders. */
function snap(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
}

export function Board(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const sessions = useStore((s) => s.sessions);
  const fileCards = useStore((s) => s.fileCards);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const setZoom = useStore((s) => s.setZoom);
  const selectedId = useStore((s) => s.selectedId);
  const selectedFileCardId = useStore((s) => s.selectedFileCardId);
  const select = useStore((s) => s.select);
  const selectFileCard = useStore((s) => s.selectFileCard);
  const panRequest = useStore((s) => s.panRequest);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);

  // native wheel: pan, ctrl+wheel: zoom around cursor
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const st = viewNow();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, st.zoom * factor));
        const k = nz / st.zoom;
        scheduleView({ zoom: nz, x: mx - (mx - st.x) * k, y: my - (my - st.y) * k });
        return;
      }
      // let terminals / file bodies scroll themselves
      const t = e.target as HTMLElement;
      if (t.closest('.term-wrap') || t.closest('.card.file .card-body')) return;
      e.preventDefault();
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      scheduleView({ x: st.x - dx, y: st.y - dy });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // space key for pan mode
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (e.code === 'Space' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('.xterm')))) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => setSpace(false));
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // pan-to-session requests
  useEffect(() => {
    if (!panRequest || panRequest.nonce === appliedPanNonce) return;
    appliedPanNonce = panRequest.nonce;
    const el = ref.current;
    const s = useStore.getState().sessions.get(panRequest.sessionId);
    if (!el || !s) return;
    const st = useStore.getState();
    const z = st.zoom < 0.6 ? 1 : st.zoom;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    setZoom(z, el.clientWidth / 2 - cx * z, el.clientHeight / 2 - cy * z);
  }, [panRequest, setZoom]);

  const onPointerDown = (e: React.PointerEvent): void => {
    const t = e.target as HTMLElement;
    // a project frame's body counts as background (pan / deselect); only its label drags the group
    const isBg = e.target === e.currentTarget || t.classList.contains('board-canvas') || t.classList.contains('ground-group') || t.classList.contains('collapsed-dots');
    const middle = e.button === 1;
    if (middle || (space && e.button === 0) || (isBg && e.button === 0)) {
      if (isBg && !middle && !space) {
        select(null);
        selectFileCard(null);
      }
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const st = useStore.getState();
      const ox = st.panX;
      const oy = st.panY;
      setPanning(true);
      const move = (ev: PointerEvent): void => scheduleView({ x: ox + (ev.clientX - startX), y: oy + (ev.clientY - startY) });
      const up = (): void => {
        setPanning(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  };

  // collapsed groups hide their cards (shown as a small box instead)
  const groups = useGroupLayout();
  const gridSize = GRID * zoom;
  const list = [...sessions.values()];
  const cards = [...fileCards.values()];

  return (
    <div
      ref={ref}
      className={`board ${panning ? 'panning' : ''} ${space ? 'space' : ''}`}
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${panX}px ${panY}px` }}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-canvas" style={{ transform: `translate(${snap(panX)}px, ${snap(panY)}px) scale(${zoom})` }}>
        <GroundGroups layout={groups} />
        <GroundLinks layout={groups} />
        {list.filter((s) => !groups.hidden.has(s.id)).map((s) => (
          <SessionCard key={s.id} session={s} layout="board" zoom={zoom} selected={selectedId === s.id} />
        ))}
        {cards.map((c) => (
          <FileCard key={c.id} card={c} selected={selectedFileCardId === c.id} />
        ))}
      </div>
      {list.length === 0 && cards.length === 0 && (
        <div className="board-empty">
          <div style={{ fontSize: 15 }}>No sessions yet</div>
          <div style={{ fontSize: 12 }}>Start an agent session with + on a folder at left, or the button below.</div>
          <button className="btn primary" onClick={() => newSessionFor()}>+ New Session (Ctrl+N)</button>
        </div>
      )}
      <Minimap containerRef={ref} />
      <div className="zoom-ctl">
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom Out (Ctrl+-)">−</button>
        <button className="pct" onClick={fitAll} title="Fit All (click)">{Math.round(zoom * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} title="Zoom In (Ctrl+=)">+</button>
      </div>
    </div>
  );
}

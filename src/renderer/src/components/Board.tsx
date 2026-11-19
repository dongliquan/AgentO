import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useStore, ZOOM_MAX, ZOOM_MIN } from '@/store';
import { fitAll, newSessionFor, zoomBy } from '@/commands';
import { SessionCard } from './SessionCard';
import { Minimap } from './Minimap';
import { GroundGroups, useGroupLayout } from './GroundGroups';
import { kbd } from '@/lib/keys';

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
let movingTimer: ReturnType<typeof setTimeout> | undefined;
/** While the Ground moves, .board.moving makes its canvas one GPU layer: a pan is a move, not a repaint of every card. */
function markMoving(): void {
  const el = document.querySelector('.board');
  if (!el) return;
  el.classList.add('moving');
  clearTimeout(movingTimer);
  movingTimer = setTimeout(() => el.classList.remove('moving'), 180);
}

function scheduleView(v: { zoom?: number; x: number; y: number }): void {
  markMoving();
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

/**
 * A flight to a picked session: the camera (the world point at the screen centre) moves in a straight line — the
 * shortest path — while the zoom eases between the two levels. The path is given to the compositor as a keyframe
 * animation (Web Animations), so the frames need no script, no re-render and no re-raster per frame: a JS-driven
 * transform re-rasterized the whole Ground on every zoom step (16 fps). The store gets the final view once; the
 * wheel or a drag ends a flight where it is.
 */
let flight: { anim: Animation; bg: Animation; el: HTMLElement; canvas: HTMLElement } | null = null;
/**
 * The card the view was last fitted to, until the user moves the view (wheel, drag, zoom buttons): a window resize
 * (maximize) fits it again — zooming in when the card had been shrunk to fit, up to 100%.
 */
let lastFit: { id: string; constrained: boolean } | null = null;
/** the view that shows a whole card: its zoom (the current one when it fits, zoomed out when not) and pan */
/**
 * The part of the Ground the floating panels leave free: the side panels and the toolbar lie over it, so a card is
 * fitted and centred in what is left (the panels publish their widths as --inset-l / --inset-r, the toolbar --inset-t).
 */
function freeArea(el: HTMLElement): { x: number; y: number; w: number; h: number } {
  const cs = getComputedStyle(document.documentElement);
  const num = (v: string): number => parseFloat(cs.getPropertyValue(v)) || 0;
  const l = num('--inset-l');
  const r = num('--inset-r');
  const t = num('--inset-t');
  return { x: l, y: t, w: Math.max(100, el.clientWidth - l - r), h: Math.max(100, el.clientHeight - t) };
}
function fitView(el: HTMLElement, s: { x: number; y: number; w: number; h: number }, zoom: number): { z: number; x: number; y: number; constrained: boolean } {
  const margin = 40;
  const a = freeArea(el);
  // 100% is the default: a card is never shrunk to fit — a card taller than the room shows from its top (its own
  // content scrolls), one that fits is centred
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const x = a.x + a.w / 2 - (s.x + s.w / 2) * z;
  const y = s.h * z + margin <= a.h ? a.y + a.h / 2 - (s.y + s.h / 2) * z : a.y + margin / 2 - s.y * z;
  return { z, x, y, constrained: false };
}
function stopFlight(): void {
  if (!flight) return;
  const { anim, bg, el, canvas } = flight;
  flight = null;
  const m = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
  anim.cancel();
  bg.cancel();
  el.classList.remove('flying');
  useStore.getState().setZoom(m.a, m.e, m.f);
}
function flyTo(el: HTMLElement, z1: number, x1: number, y1: number): void {
  stopFlight();
  const canvas = el.querySelector<HTMLElement>('.board-canvas');
  const st = useStore.getState();
  const z0 = st.zoom;
  const x0 = st.panX;
  const y0 = st.panY;
  const free = freeArea(el);
  const MX = free.x + free.w / 2;
  const MY = free.y + free.h / 2;
  const c0x = (MX - x0) / z0;
  const c0y = (MY - y0) / z0;
  const c1x = (MX - x1) / z1;
  const c1y = (MY - y1) / z1;
  const dist = Math.hypot((c1x - c0x) * Math.max(z0, z1), (c1y - c0y) * Math.max(z0, z1));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // longer for a longer way and a bigger zoom change, within 0.3–0.9 s
  const dur = reduced || !canvas || typeof canvas.animate !== 'function' ? 0 : Math.min(900, 300 + dist * 0.2 + Math.abs(Math.log(z1 / z0)) * 200);
  if (dur === 0 || (dist < 1 && Math.abs(z1 - z0) < 1e-6)) {
    st.setZoom(z1, x1, y1);
    return;
  }
  // the straight path with the easing baked into evenly spaced keyframes (the compositor interpolates between them)
  const N = 30;
  const frames: Keyframe[] = [];
  const bgFrames: Keyframe[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out
    const z = z0 * Math.pow(z1 / z0, e);
    const cx = c0x + (c1x - c0x) * e;
    const cy = c0y + (c1y - c0y) * e;
    const x = MX - cx * z;
    const y = MY - cy * z;
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${z})` });
    bgFrames.push({ backgroundPosition: `${x}px ${y}px`, backgroundSize: `${GRID * z}px ${GRID * z}px` });
  }
  el.classList.add('flying');
  const anim = canvas!.animate(frames, { duration: dur, easing: 'linear', fill: 'forwards' });
  const bg = el.animate(bgFrames, { duration: dur, easing: 'linear', fill: 'forwards' });
  const mine = { anim, bg, el, canvas: canvas! };
  flight = mine;
  anim.onfinish = () => {
    if (flight !== mine) return;
    flight = null;
    useStore.getState().setZoom(z1, x1, y1);
    // the animation holds the last frame until the store's view has been drawn, then lets the inline style take over
    requestAnimationFrame(() => {
      anim.cancel();
      bg.cancel();
      el.classList.remove('flying');
    });
  };
}

/** Snap to whole device pixels: fractional translations blur text and 1px borders. */
function snap(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
}

export function Board(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const sessions = useStore((s) => s.sessions);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const panRequest = useStore((s) => s.panRequest);
  const minimapOpen = useStore((s) => s.minimapOpen);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);

  // native wheel: pan, ctrl+wheel: zoom around cursor
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      stopFlight();
      lastFit = null;
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
      // the selected card scrolls its own content (chat, terminal); terminals always do
      const t = e.target as HTMLElement;
      if (t.closest('.card.selected .card-body') || t.closest('.term-wrap')) return;
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
    const blur = (): void => setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
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
    // the card in the visible Ground at 100% (a zoom deliberately set above 100% stays)
    const v = fitView(el, s, Math.max(1, st.zoom));
    lastFit = { id: s.id, constrained: v.constrained };
    flyTo(el, v.z, v.x, v.y);
  }, [panRequest]);

  // the Ground got bigger or smaller (maximize, a panel opened): the card it was fitted to is fitted again
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      if (now.w === last.w && now.h === last.h) return;
      last = now;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useStore.getState();
        const fit = lastFit;
        if (!fit || st.selectedId !== fit.id) return;
        const s = st.sessions.get(fit.id);
        if (!s || now.w === 0 || now.h === 0) return;
        // centred again at the same zoom
        const v = fitView(el, s, st.zoom);
        lastFit = { id: s.id, constrained: v.constrained };
        flyTo(el, v.z, v.x, v.y);
      }, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // a selected session stands out: the other cards step back (hover brings one forward)
  const spotlight = useStore((st) => st.selectedId !== null && st.sessions.has(st.selectedId));
  const onPointerDown = (e: React.PointerEvent): void => {
    const t = e.target as HTMLElement;
    // a project frame's body counts as background (pan / deselect); only its label drags the group
    const isBg = e.target === e.currentTarget || t.classList.contains('board-canvas') || t.classList.contains('ground-group') || t.classList.contains('collapsed-dots');
    const middle = e.button === 1;
    if (middle || (space && e.button === 0) || (isBg && e.button === 0)) {
      e.preventDefault();
      stopFlight();
      lastFit = null;
      const startX = e.clientX;
      const startY = e.clientY;
      const st = useStore.getState();
      const ox = st.panX;
      const oy = st.panY;
      let moved = false;
      setPanning(true);
      const move = (ev: PointerEvent): void => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
        scheduleView({ x: ox + (ev.clientX - startX), y: oy + (ev.clientY - startY) });
      };
      const up = (): void => {
        // moving the Ground keeps the selection; a plain click on empty space clears it
        if (!moved && isBg && !middle && !space) {
          select(null);
        }
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

  return (
    <div
      ref={ref}
      className={`board ${panning ? 'panning' : ''} ${space ? 'space' : ''} ${spotlight ? 'spotlight' : ''}`}
      style={{ backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${panX}px ${panY}px` }}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="board-canvas" style={{ transform: `translate(${snap(panX)}px, ${snap(panY)}px) scale(${zoom})` }}>
        <GroundGroups layout={groups} />
        {list.filter((s) => !groups.hidden.has(s.id)).map((s) => (
          <SessionCard key={s.id} session={s} layout="board" zoom={zoom} selected={selectedId === s.id} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="board-empty">
          <div style={{ fontSize: 15 }}>No sessions yet</div>
          <div style={{ fontSize: 12 }}>Start an agent session with + on a folder at left, or the button below.</div>
          <button className="btn primary" onClick={() => newSessionFor()}>{kbd('+ New Session (Ctrl+N)')}</button>
        </div>
      )}
      {minimapOpen && <Minimap containerRef={ref} />}
      <div className="zoom-ctl" onClickCapture={() => { lastFit = null; }}>
        <button onClick={() => zoomBy(1 / 1.2)} title={kbd('Zoom Out (Ctrl+-)')}>−</button>
        <button className="pct" onClick={fitAll} title="Fit All (click)">{Math.round(zoom * 100)}%</button>
        <button onClick={() => zoomBy(1.2)} title={kbd('Zoom In (Ctrl+=)')}>+</button>
      </div>
    </div>
  );
}

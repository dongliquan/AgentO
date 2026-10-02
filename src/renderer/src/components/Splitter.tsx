import type React from 'react';

/**
 * Panel widths live in CSS variables on :root and are remembered per viewer: the main window's columns share it by
 * window share (--side-share, --right-share; the Ground takes the rest), the panels window's left column has a width
 * (--panels-left-w).
 * A Splitter is the 5 px drag handle between two columns.
 */
const KEY = 'asm.widths';

function readWidths(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * The main window's side columns each take a share of the window width (percent), the Ground takes the rest:
 * sidebar 15, right panel 35 (the Ground about half). A share is its own: moving one handle never changes the other column.
 */
const SHARE_VARS = ['--side-share', '--right-share'];

/** Apply remembered widths at startup. */
export function applyStoredWidths(): void {
  for (const [v, w] of Object.entries(readWidths())) {
    if (!v.startsWith('--') || !Number.isFinite(w)) continue;
    if (SHARE_VARS.includes(v)) document.documentElement.style.setProperty(v, String(w));
    // earlier layouts (fixed widths, flex shares) are left behind
    else if (v === '--panels-left-w') document.documentElement.style.setProperty(v, `${w}px`);
  }
}

function share(v: string, fallback: number): number {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The handle of a side column whose width is a share of the window (`cssVar`, percent). dir +1: the column is on the
 * left (dragging right widens it); -1: on the right. Double-click: back to its default share.
 */
export function ShareSplitter({ cssVar, dir, fallback, min, max }: { cssVar: string; dir: 1 | -1; fallback: number; min: number; max: number }): JSX.Element {
  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = share(cssVar, fallback);
    let v = start;
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      v = Math.round(Math.min(max, Math.max(min, start + (dir * (ev.clientX - startX) * 100) / window.innerWidth)) * 10) / 10;
      document.documentElement.style.setProperty(cssVar, String(v));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readWidths(), [cssVar]: v }));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = (): void => {
    document.documentElement.style.removeProperty(cssVar);
    const rest = readWidths();
    delete rest[cssVar];
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable */
    }
  };
  return <div className="splitter" onPointerDown={onDown} onDoubleClick={reset} title={`Drag to resize · double-click for ${fallback}% of the window`} />;
}

function currentWidth(cssVar: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
  return Number.isFinite(v) ? v : fallback;
}

interface Props {
  /** CSS variable holding the width it changes */
  cssVar: string;
  min: number;
  max: number;
  /** +1: the column on the left grows when dragging right; -1: the column on the right grows when dragging left */
  dir: 1 | -1;
}

export function Splitter({ cssVar, min, max, dir }: Props): JSX.Element {
  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = currentWidth(cssVar, min);
    let w = startW;
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent): void => {
      w = Math.round(Math.min(max, Math.max(min, startW + dir * (ev.clientX - startX))));
      document.documentElement.style.setProperty(cssVar, `${w}px`);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readWidths(), [cssVar]: w }));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = (): void => {
    document.documentElement.style.removeProperty(cssVar);
    const rest = readWidths();
    delete rest[cssVar];
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable */
    }
  };
  return <div className="splitter" onPointerDown={onDown} onDoubleClick={reset} title="Drag to resize · double-click to reset" />;
}

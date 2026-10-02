import type React from 'react';

/**
 * Panel widths live in CSS variables on :root (--sidebar-w, --right-w, --panels-left-w) and are remembered per viewer.
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

/** Apply remembered widths at startup. */
export function applyStoredWidths(): void {
  for (const [v, w] of Object.entries(readWidths())) {
    if (v.startsWith('--') && Number.isFinite(w)) document.documentElement.style.setProperty(v, `${w}px`);
  }
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

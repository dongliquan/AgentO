import type React from 'react';

export interface DragOpts {
  /** scale between screen pixels and canvas units (zoom). 1 for unscaled layouts. */
  scale?: () => number;
  onStart?: () => void;
  onMove: (dx: number, dy: number, e: PointerEvent) => void;
  onEnd?: () => void;
  /** minimum pixel movement before the drag starts (prevents click from being swallowed) */
  threshold?: number;
}

/**
 * Pointer-drag helper. Returns an onPointerDown handler. Deltas are reported in canvas units
 * (screen delta / scale), accumulated from the drag origin.
 */
export function startDrag(e: React.PointerEvent, opts: DragOpts): void {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;
  const threshold = opts.threshold ?? 3;
  const scale = opts.scale ?? ((): number => 1);

  const move = (ev: PointerEvent): void => {
    const dxs = ev.clientX - startX;
    const dys = ev.clientY - startY;
    if (!started) {
      if (Math.abs(dxs) < threshold && Math.abs(dys) < threshold) return;
      started = true;
      opts.onStart?.();
    }
    const s = scale() || 1;
    opts.onMove(dxs / s, dys / s, ev);
  };
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (started) opts.onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Returns a throttled function that calls `fn` at most every `ms` and always flushes the last call. */
export function throttle<T extends unknown[]>(fn: (...args: T) => void, ms: number): ((...args: T) => void) & { flush: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;
  const run = (): void => {
    if (pending) {
      const a = pending;
      pending = null;
      last = Date.now();
      fn(...a);
    }
  };
  const wrapped = ((...args: T): void => {
    pending = args;
    const elapsed = Date.now() - last;
    if (elapsed >= ms) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        run();
      }, ms - elapsed);
    }
  }) as ((...args: T) => void) & { flush: () => void };
  wrapped.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    run();
  };
  return wrapped;
}

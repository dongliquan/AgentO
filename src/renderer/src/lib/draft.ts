import { useCallback, useState } from 'react';

/** In-memory copy, so a draft survives its component unmounting (switching tabs) without re-reading storage. */
const cache = new Map<string, unknown>();
const KEY = (k: string): string => `asm.draft.${k}`;

/**
 * State for a form field that should outlive its component: switching tabs or restarting the app keeps what was
 * typed until it is sent. Kept per viewer in localStorage (a convenience: losing it is harmless).
 */
export function useDraft<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (cache.has(key)) return cache.get(key) as T;
    try {
      const raw = localStorage.getItem(KEY(key));
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* storage unavailable or bad JSON */
    }
    return initial;
  });
  const set = useCallback(
    (v: T) => {
      cache.set(key, v);
      try {
        localStorage.setItem(KEY(key), JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
      setValue(v);
    },
    [key]
  );
  return [value, set];
}

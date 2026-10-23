import { useCallback, useState } from 'react';

/** In-memory copy, so a draft survives its component unmounting (switching tabs) without re-reading storage. */
const cache = new Map<string, unknown>();
const KEY = (k: string): string => `asm.draft.${k}`;

/** The draft's current value without subscribing (for code outside the form that owns it). */
export function readDraft<T>(key: string, initial: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const raw = localStorage.getItem(KEY(key));
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* storage unavailable or bad JSON */
  }
  return initial;
}

/** Set a draft from outside its form: the form reads it the next time it mounts. */
export function writeDraft<T>(key: string, v: T): void {
  cache.set(key, v);
  try {
    localStorage.setItem(KEY(key), JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

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

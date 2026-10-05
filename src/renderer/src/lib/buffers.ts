import { create } from 'zustand';

/**
 * Raw terminal output per session (the last BUFFER_CAP chars), kept outside the app store.
 *
 * Output arrives many times a second per session. Keeping it in the main store meant copying the buffers Map and
 * notifying every subscriber of the whole app on each chunk. Here the text lives in a plain Map; readers subscribe to a
 * per-session version that is bumped at most once per animation frame. The terminal itself is fed directly through
 * the term bus and does not wait for that.
 */
export const BUFFER_CAP = 200 * 1024;
/** trim only after this much overflow, so a full buffer is not re-copied on every chunk */
const TRIM_AT = BUFFER_CAP + 64 * 1024;

const bufs = new Map<string, string>();
const useVer = create<{ ver: Record<string, number> }>(() => ({ ver: {} }));

const dirty = new Set<string>();
let scheduled = false;
function flush(): void {
  scheduled = false;
  if (dirty.size === 0) return;
  const ver = { ...useVer.getState().ver };
  for (const id of dirty) ver[id] = (ver[id] ?? 0) + 1;
  dirty.clear();
  useVer.setState({ ver });
}
function touch(id: string): void {
  dirty.add(id);
  if (scheduled) return;
  scheduled = true;
  // rAF pauses in a hidden window; a timer fallback keeps readers (previews, prompt cards) current there too
  if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(flush);
  else setTimeout(flush, 250);
}

export function getBuffer(id: string): string | undefined {
  return bufs.get(id);
}

export function appendBuffer(id: string, data: string): void {
  let b = (bufs.get(id) ?? '') + data;
  if (b.length > TRIM_AT) b = b.slice(b.length - BUFFER_CAP);
  bufs.set(id, b);
  touch(id);
}

export function setBuffer(id: string, data: string): void {
  bufs.set(id, data.length > BUFFER_CAP ? data.slice(data.length - BUFFER_CAP) : data);
  touch(id);
}

export function dropBuffer(id: string): void {
  if (bufs.delete(id)) touch(id);
}

/** A session's output, re-rendering the caller when it changes (at most once a frame). `enabled` false: no subscription. */
export function useBuffer(id: string, enabled = true): string | undefined {
  useVer((st) => (enabled ? st.ver[id] ?? 0 : 0));
  return enabled ? bufs.get(id) : undefined;
}

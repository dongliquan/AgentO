/**
 * Lightweight per-session event bus so mounted xterm instances receive live output
 * without re-rendering React trees on every chunk.
 */
export type TermEvent = { kind: 'data'; data: string } | { kind: 'scrollback'; data: string };
type Handler = (ev: TermEvent) => void;

const handlers = new Map<string, Set<Handler>>();

export function onTerm(sessionId: string, h: Handler): () => void {
  let set = handlers.get(sessionId);
  if (!set) {
    set = new Set();
    handlers.set(sessionId, set);
  }
  set.add(h);
  return () => {
    set?.delete(h);
    if (set && set.size === 0) handlers.delete(sessionId);
  };
}

export function emitTerm(sessionId: string, ev: TermEvent): void {
  const set = handlers.get(sessionId);
  if (!set) return;
  for (const h of set) {
    try {
      h(ev);
    } catch (e) {
      console.error('[termbus]', e);
    }
  }
}

import { useStore } from '@/store';

/**
 * What the manager typed into sessions, kept in this browser (localStorage, never sent anywhere): ↑ in an empty message
 * box brings the earlier ones back, and the short phrases typed again and again become one-click chips above the box.
 * The first time it starts from the manager's direct inputs the inbox already holds.
 */
const KEY = 'asm.inputHistory';
const MAX_ITEMS = 300;
const MAX_CHARS = 600;
/** chips: short phrases only, typed at least this often */
const CHIP_MAX_CHARS = 40;
const CHIP_MIN_COUNT = 3;

interface Item {
  text: string;
  /** how many times it was typed */
  n: number;
  /** last time (ms) */
  at: number;
}

let cache: Item[] | null = null;

function save(items: Item[]): void {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* kept in memory only */
  }
}

/** The manager's direct inputs in the inbox ("Manager (you) · Direct → <session>: <text>"), oldest first. */
function seedFromInbox(): Item[] {
  const by = new Map<string, Item>();
  const items = useStore.getState().inbox.filter((i) => i.kind === 'directive' && i.fromId === 'user').sort((a, b) => a.createdAt - b.createdAt);
  for (const it of items) {
    const m = /^Manager \(you\) · Direct[^:\n]*: ([\s\S]*)$/.exec(it.text);
    const text = clean(m?.[1] ?? '');
    if (!text || text.length > MAX_CHARS) continue;
    const cur = by.get(text);
    if (cur) {
      cur.n++;
      cur.at = it.createdAt;
    } else by.set(text, { text, n: 1, at: it.createdAt });
  }
  return [...by.values()];
}

/** An attached image / file block is not part of what was typed. */
function clean(t: string): string {
  return t.replace(/\s*\[Attached image[\s\S]*$/, '').trim();
}

function load(): Item[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as Item[];
      if (Array.isArray(list)) return (cache = list);
    }
  } catch {
    /* start over */
  }
  const seeded = seedFromInbox();
  // an empty inbox (not loaded yet) is not worth remembering as "seeded"
  if (seeded.length) save(seeded);
  else cache = [];
  return cache!;
}

/** Remember one message the manager sent. */
export function recordInput(raw: string): void {
  const text = clean(raw);
  if (!text || text.length > MAX_CHARS) return;
  const list = [...load()];
  const cur = list.find((i) => i.text === text);
  if (cur) {
    cur.n++;
    cur.at = Date.now();
  } else list.push({ text, n: 1, at: Date.now() });
  // over the cap: the oldest, least repeated ones go first
  if (list.length > MAX_ITEMS) list.sort((a, b) => b.n * 1e12 + b.at - (a.n * 1e12 + a.at)).length = MAX_ITEMS;
  save(list);
  window.dispatchEvent(new Event('asm-input-history'));
}

/** Earlier messages, newest first (↑ walks down this list). */
export function recentInputs(): string[] {
  return [...load()].sort((a, b) => b.at - a.at).map((i) => i.text);
}

/** Short phrases typed again and again, most often first. */
export function frequentInputs(limit = 6): string[] {
  return load()
    .filter((i) => i.text.length <= CHIP_MAX_CHARS && i.n >= CHIP_MIN_COUNT && !i.text.includes('\n'))
    .sort((a, b) => b.n - a.n || b.at - a.at)
    .slice(0, limit)
    .map((i) => i.text);
}

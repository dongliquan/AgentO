import type { InboxItem } from '@shared/protocol';

/**
 * Where a question to the manager comes from: the piece of work (#T) and the session whose result it is about.
 *
 * The session's report that holds the question is found by what the question says (the report that shares the most
 * of its words, newest first). That report belongs to the order it answers: its own number when it has one, else the
 * message the session had received just before and that shares most with it (a "finished" report of another session,
 * or the manager's own order). The session is the one that finished it, or else the one the asking session handed work to
 * for that order.
 */
export interface AskedOrigin {
  taskId?: string;
  /** the session the question is about */
  aboutId?: string;
}

const WORD = /[A-Za-z0-9~_.-]{2,}|[가-힣]{2,}/g;
/** A word as it is compared: Korean words lose their ending (particles), the rest is lower case. */
const stem = (w: string): string => (/[가-힣]/.test(w) ? w.slice(0, Math.max(2, Math.min(3, w.length - 1))) : w.toLowerCase());
/** Digits and capitals ("N1~N11", "T405", file names) tell reports apart; plain words count less. */
const weight = (w: string): number => (/[0-9A-Z]/.test(w) ? 3 : w.length >= 4 ? 1 : 0.5);

function words(text: string): { stem: string; w: number }[] {
  const seen = new Map<string, number>();
  for (const m of text.matchAll(WORD)) {
    const s = stem(m[0]);
    seen.set(s, Math.max(seen.get(s) ?? 0, weight(m[0])));
  }
  return [...seen].map(([s, w]) => ({ stem: s, w }));
}

/** How much of `of` appears in `text` (sum of word weights). */
function overlap(of: { stem: string; w: number }[], text: string): number {
  const low = text.toLowerCase();
  let n = 0;
  for (const x of of) if (low.includes(x.stem)) n += x.w;
  return n;
}

const SOURCE_WINDOW = 36 * 3_600_000;
const INPUT_WINDOW = 20 * 60_000;

export function findOrigin(inbox: InboxItem[], sessionId: string, question: string, at: number): AskedOrigin {
  const mine = inbox.filter((i) => i.sessionId === sessionId && i.createdAt <= at + 60_000 && i.createdAt >= at - SOURCE_WINDOW);
  // a "#T399" in the question is a reference to another piece of work, not what identifies this question
  const q = words(question).filter((x) => !/^t\d+$/i.test(x.stem));
  // the session's own report that holds the question (to the manager or handed on). A question that carries a
  // distinctive word ("N1~N11") is repeated in every later report: the origin is the first one that says it.
  const reports = mine.filter((i) => i.kind === 'report' && i.fromId === sessionId).sort((x, y) => x.createdAt - y.createdAt);
  const key = q.filter((x) => x.w >= 3);
  const keyWeight = key.reduce((n, x) => n + x.w, 0);
  let source: InboxItem | undefined;
  if (key.length) source = reports.find((it) => overlap(key, it.text) >= keyWeight);
  if (!source) {
    let best = 0;
    for (const it of reports) {
      const sc = overlap(q, it.text);
      if (sc > 0 && sc >= best) {
        best = sc;
        source = it;
      }
    }
  }
  if (!source) return {};
  // when the order this report answers reached the session: work handed on counts only after that
  const received = (taskId: string | undefined): number => {
    let at = 0;
    for (const it of inbox) if (it.kind === 'directive' && it.sessionId === sessionId && it.taskId === taskId && it.fromId !== sessionId) at = Math.max(at, it.createdAt);
    return at;
  };
  let since = 0;
  const handedTo = (t: number): string | undefined => {
    // the session this one last handed work to for that order, before time t
    let h: InboxItem | undefined;
    for (const it of inbox) {
      if (it.kind === 'directive' && it.fromId === sessionId && it.sessionId !== sessionId && it.createdAt >= since && it.createdAt <= t + 60_000 && (!h || it.createdAt > h.createdAt)) h = it;
    }
    return h?.sessionId;
  };
  if (source.taskId) since = received(source.taskId);
  if (source.taskId) return { taskId: source.taskId, aboutId: handedTo(source.createdAt) };
  // a report without a number answers something it received just before: the closest in content
  const src = words(source.text.slice(0, 1500));
  let from: InboxItem | undefined;
  let fromScore = -1;
  for (const it of mine) {
    if (!it.taskId || it.createdAt >= source.createdAt || it.createdAt < source.createdAt - INPUT_WINDOW) continue;
    if (it.fromId === sessionId) continue;
    const sc = overlap(src, it.text);
    if (sc > fromScore || (sc === fromScore && from && it.createdAt > from.createdAt)) {
      fromScore = sc;
      from = it;
    }
  }
  if (!from) return {};
  // finished by another session: that session; the manager's own order: whoever it was handed to
  const other = from.fromId !== 'user' && from.fromId !== sessionId ? from.fromId : undefined;
  return { taskId: from.taskId, aboutId: other ?? handedTo(source.createdAt) };
}

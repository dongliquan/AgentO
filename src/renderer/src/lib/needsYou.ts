import { useMemo, useSyncExternalStore } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useClosedSessionIds, useOpenInbox } from './closed';

/**
 * What waits for the manager right now:
 * - prompt: a session stopped on a question in its terminal (trust / permission / choice)
 * - question: a session's latest report to the manager ends asking for a decision ("어느 쪽으로 할지 알려주시면…",
 *   "…찾아볼까요?", "Should I …?") and the manager has not written to that session since
 * A question the manager dealt with elsewhere can be dismissed (kept in this browser).
 */
export interface NeedsYou {
  sessionId: string;
  kind: 'prompt' | 'question';
  /** the asking part of the report (its last paragraphs), or the prompt */
  text: string;
  at: number;
  itemId?: string;
  /** what dismissing it remembers: the report's id, or the prompt's session and time */
  key: string;
}

// the end of a report that asks the manager for something; generic closings ("새 주문이 있으면 말씀해 주세요",
// "완료 보고가 오면 전달하겠습니다") don't count
const ASKS = /\?|까요|할지|할까|정해\s?주세요|골라\s?주세요|선택해\s?주세요|알려\s?주(?:세요|시면|십시오)|말씀해\s?주(?:세요|시면)|확인해\s?주(?:세요|시면)|결정\s?(?:대기|해\s?주|이\s?필요|이\s?나면|해야)|어느\s?쪽|괜찮을까|should i|shall i|which (?:one|option)|let me know|please (?:confirm|decide|choose)|do you want|if you want me to|want me to/i;
// optional offers and closings: "다른 이름을 원하시면 말씀해 주세요", "고칠 점이 있으면 알려 주세요", "필요하시면 말씀해 주세요"
const OPTIONAL = /(?:있으면|있으시면|원하시면|필요하시면|필요해지면|생기면|안\s?보이면|문제가\s?있으면)\s*(?:언제든\s*)?(?:알려|말씀|다시\s?꺼내)[^.?!\n]{0,12}/g;
const GENERIC = /(새\s?(?:주문|지시|요청)|다른\s?(?:주문|지시|일)|추가로\s?필요).{0,20}(있으면|있으시면)|if you (?:have|need) anything/i;

/** The asking tail of a report, or null when it does not ask the manager anything. */
export function askingTail(text: string): string | null {
  const body = text.replace(/^[^:\n]{0,120}?(?:→ Manager \(you\)|finished|replied|reported)\s*:\s*/, '');
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // the last two paragraphs, without a generic closing line
  const tail = paras.slice(-2).filter((p) => !(GENERIC.test(p) && p.length < 120));
  const t = tail.join('\n\n');
  if (!t || !ASKS.test(t.replace(OPTIONAL, ''))) return null;
  return t.length > 600 ? `…${t.slice(-600)}` : t;
}

/* dismissed questions (item ids), per browser */
const KEY = 'asm.needsYou.dismissed';
let dismissed: Set<string> = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
})();
const subs = new Set<() => void>();
export function dismissNeed(key: string): void {
  dismissed = new Set(dismissed).add(key);
  try {
    localStorage.setItem(KEY, JSON.stringify([...dismissed].slice(-500)));
  } catch {
    /* not kept */
  }
  subs.forEach((f) => f());
}
const useDismissed = (): Set<string> =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => dismissed
  );

/** Report text never changes: its asking tail is worked out once per report. */
const tails = new Map<string, string | null>();
function tailOf(it: InboxItem): string | null {
  let t = tails.get(it.id);
  if (t === undefined) {
    t = askingTail(it.text);
    if (tails.size > 2000) tails.clear();
    tails.set(it.id, t);
  }
  return t;
}

export function computeNeeds(sessions: Map<string, Session>, inbox: InboxItem[], closed: Set<string>, gone: Set<string>): NeedsYou[] {
  const out: NeedsYou[] = [];
  const lastReport = new Map<string, InboxItem>();
  const lastFromUser = new Map<string, number>();
  for (const it of inbox) {
    if (it.kind === 'report' && it.fromId === it.sessionId) {
      const cur = lastReport.get(it.sessionId);
      if (!cur || it.createdAt > cur.createdAt) lastReport.set(it.sessionId, it);
    } else if (it.kind === 'directive' && it.fromId === 'user') {
      lastFromUser.set(it.sessionId, Math.max(lastFromUser.get(it.sessionId) ?? 0, it.createdAt));
    }
  }
  for (const s of sessions.values()) {
    if (closed.has(s.id)) continue;
    if (s.status === 'waiting' && s.attention) {
      const key = `p:${s.id}:${s.updatedAt}`;
      if (!gone.has(key)) out.push({ sessionId: s.id, kind: 'prompt', text: 'Waiting on a prompt in its terminal (a choice or permission).', at: s.updatedAt, key });
      continue;
    }
    const r = lastReport.get(s.id);
    // answered (the manager wrote to it since), busy again, or dealt with
    if (!r || gone.has(r.id) || (lastFromUser.get(s.id) ?? 0) > r.createdAt || s.status === 'working' || s.status === 'starting') continue;
    const tail = tailOf(r);
    if (tail) out.push({ sessionId: s.id, kind: 'question', text: tail, at: r.createdAt, itemId: r.id, key: r.id });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The current "needs you" list (open projects only) — computed by <NeedsYouWatcher />; others read useNeedsIds. */
export function useNeedsYou(): NeedsYou[] {
  const sessions = useStore((s) => s.sessions);
  const closed = useClosedSessionIds();
  const inbox = useOpenInbox();
  const gone = useDismissed();
  return useMemo(() => computeNeeds(sessions, inbox, closed, gone), [sessions, inbox, closed, gone]);
}

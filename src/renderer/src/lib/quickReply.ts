import type { ChatEntry } from '@shared/protocol';

export interface QuickOption {
  /** what is sent: "A", "2" … */
  key: string;
  /** a short label for the button */
  label: string;
}
export interface QuickReply {
  options: QuickOption[];
  /** several may be picked ("all that apply") */
  multi: boolean;
  /** yes/no questions instead of options ("이어서 할까요?", "push 해도 될까요?"): one each, answered yes or no */
  questions?: string[];
  /** answer in Korean (the questions are) */
  ko?: boolean;
}

// "A. …", "**B.** …", "- 2) …", "1. **포팅부터 진행** — …", and "- **A** — …" / "A — …" / "A: …"
const OPTION = /^\s*(?:[-*]\s+)?\*{0,2}([A-Ha-h]|[1-9])[.)]\*{0,2}\s+(.+)$/;
const OPTION_DASH = /^\s*(?:[-*]\s+)?(?:\*\*([A-H1-9])\*\*|([A-H]))\s*[—–:]\s*(.+)$/;
function matchOption(line: string): [string, string] | null {
  const m = OPTION.exec(line);
  if (m) return [m[1]!, m[2]!];
  const d = OPTION_DASH.exec(line);
  return d ? [(d[1] ?? d[2])!, d[3]!] : null;
}
const ASKS = /\?|？|할까요|될까요|좋을까요|원하시|선택|골라|어느|어떤|정해 주|알려 주|말씀해|which|should i|do you want|would you like|choose|pick|let me know/i;
const MULTI = /여러|복수|모두 고르|해당하는 것을 모두|all that apply|any of|multiple|select (?:all|any)/i;

const plain = (s: string): string =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();

/**
 * Choices the session's last answer offers: an answer that ends asking something and lists options (A./B./C. or
 * 1./2./3.) gets quick-reply buttons. Plain numbered steps in a report are not options: there must be a question near
 * the end, the keys must run in order from A or 1, and the list must sit in the last part of the answer.
 */
export function quickReplyOf(entries: ChatEntry[]): QuickReply | null {
  // the last thing said is the session's answer (nothing typed after it)
  let last: ChatEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'user') return null;
    if (e.kind === 'assistant') {
      last = e;
      break;
    }
  }
  const text = last?.text ?? '';
  if (!text) return null;
  const tail = text.slice(-2500);
  if (!ASKS.test(tail.slice(-600))) return null;
  const lines = tail.split('\n');
  // the last run of option lines, keys in order
  let best: QuickOption[] = [];
  let cur: QuickOption[] = [];
  const next = (k: string): string => String.fromCharCode(k.charCodeAt(0) + 1);
  for (const line of lines) {
    const m = matchOption(line);
    if (m) {
      const key = m[0].toUpperCase();
      const first = key === 'A' || key === '1';
      if (cur.length && key === next(cur[cur.length - 1]!.key)) cur.push(opt(key, m[1]));
      else if (first) cur = [opt(key, m[1])];
      else cur = [];
      if (cur.length >= 2) best = [...cur];
    } else if (line.trim() && !/^\s{2,}|^\s*[-*]\s/.test(line)) {
      // a plain paragraph ends a list; indented / bulleted detail lines belong to the option above
      if (cur.length) cur = [];
    }
  }
  if (best.length >= 2 && best.length <= 8) return { options: best, multi: MULTI.test(tail) };
  // no options: yes/no questions at the end ("1244 하나입니다. 이어서 할까요?", "커밋 5건 push 해도 될까요?")
  const questions = yesNoQuestions(text.slice(-900));
  return questions.length ? { options: [], multi: questions.length > 1, questions, ko: /[가-힣]/.test(questions.join('')) } : null;
}

// a question answered yes or no (not "어느 쪽 / which / how …")
const YES_NO = /(할까요|될까요|드릴까요|볼까요|갈까요|넘어갈까요|진행할까요|좋을까요|괜찮을까요|되나요|할지요|맞나요|맞습니까|합니까|하시겠어요|하시겠습니까|원하시나요|\b(?:shall|should|can|may) i\b|\bdo you want\b|\bwould you like\b|\bis it ok\b|\bok to\b)/i;
const WH = /어느|어떤|어떻게|무엇|뭘|뭐를|언제|어디|몇 |\b(?:which|what|how|when|where|why)\b/i;

function yesNoQuestions(tail: string): string[] {
  // sentences that end with "?", from the last paragraphs
  const out: string[] = [];
  for (const para of tail.split(/\n\s*\n/).slice(-3)) {
    for (const raw of para.split('\n')) {
      const line = plain(raw.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''));
      // sentences of the line; a short question ("이어서 할까요?") keeps the sentence before it for context
      const parts = line.match(/[^.!?。？]+[.!?。？]?/g) ?? [];
      for (let i = 0; i < parts.length; i++) {
        const s = parts[i]!.trim();
        if (!/[?？]$/.test(s)) continue;
        const q = s.length < 20 && i > 0 ? `${parts[i - 1]!.trim()} ${s}` : s;
        if (s.length < 4 || WH.test(s) || !YES_NO.test(s)) continue;
        out.push(q.length > 90 ? `${q.slice(0, 88)}…` : q);
      }
    }
  }
  return out.slice(-4);
}

function opt(key: string, rest: string): QuickOption {
  const label = plain(rest).split(/\s+[—–-]\s+|:\s/)[0]!.slice(0, 60);
  return { key, label: label || key };
}

import { useState } from 'react';
import type { Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useChats } from '@/lib/chat';
import { useNow } from '@/lib/hooks';
import { relativeTime } from '@/lib/format';
import { lastLines } from '@/lib/ansi';
import { firstLine, orderProgress, type WorkState } from '@/lib/progress';
import type { LogNode } from '@/lib/threads';
import { selectAndReveal } from '@/commands';
import { toolSummary } from './ChatView';
import { useBuffer } from '@/lib/buffers';

const STATE_LABEL: Record<WorkState, string> = {
  done: 'done',
  working: 'working',
  waiting: 'idle',
  stopped: 'stopped',
  error: 'error',
  removed: 'removed'
};

/** What a session is doing right now: its running tool, else its last words, else the end of its terminal. */
function Activity({ session: s }: { session: Session }): JSX.Element | null {
  const chat = useChats((st) => st.chats[s.id]);
  const buf = useBuffer(s.id);
  const now = useNow(15000);
  const entries = chat?.entries ?? [];
  const lastEntry = entries[entries.length - 1];
  let text = '';
  let at = lastEntry?.ts ?? 0;
  const running = [...entries].reverse().find((e) => e.kind === 'tool' && e.tool && !e.tool.done);
  if (running?.tool && s.status === 'working') {
    const { title, detail } = toolSummary(running.tool, s.cwd);
    text = detail ? `${title} · ${detail}` : title;
    at = running.ts;
  } else {
    const said = [...entries].reverse().find((e) => e.kind === 'assistant' && e.text?.trim());
    if (said?.text) {
      text = said.text.trim().split('\n').find((l) => l.trim()) ?? '';
      at = said.ts;
    } else {
      text = lastLines(buf ?? '', 1)[0] ?? '';
    }
  }
  if (!text) return null;
  return (
    <span className="work-activity" title={text}>
      <span className="ellipsis">{text}</span>
      {at > 0 && <span className="muted"> · {relativeTime(at, now)}</span>}
    </span>
  );
}

/**
 * Progress of one of the manager's orders, read from the team traffic: pieces of work handed down, how many came back,
 * who is still on it and what they are doing now — so the manager does not have to ask.
 */
export function OrderProgress({ node, open: openByDefault = false }: { node: LogNode; open?: boolean }): JSX.Element | null {
  const sessions = useStore((s) => s.sessions);
  const now = useNow(15000);
  const [open, setOpen] = useState(openByDefault);
  const p = orderProgress(node, sessions);
  if (p.total === 0) return null;
  const pct = Math.round((p.done / p.total) * 100);
  const allDone = p.done === p.total;
  return (
    <div className={`order-progress ${allDone ? 'complete' : ''}`}>
      <button className="order-progress-row" onClick={() => setOpen(!open)} title={open ? 'Hide the pieces of work' : 'Show the pieces of work'}>
        <span className="bar"><span style={{ width: `${pct}%` }} /></span>
        <span className="n">{p.done}/{p.total} {p.total === 1 ? 'piece' : 'pieces'} done</span>
        {p.working > 0 && <span className="working">· {p.working} working</span>}
        {!allDone && p.working === 0 && <span className="muted">· nothing running</span>}
        <span className="grow" />
        <span className="muted">{relativeTime(p.lastAt, now)}</span>
        <span className="caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="order-work">
          {p.items.map((w) => (
            <li key={w.node.item.id} className={`work ${w.state}`}>
              <span className={`status-dot ${w.state === 'done' ? 'done' : w.state === 'removed' ? 'hibernated' : w.state === 'stopped' ? 'done' : w.state}`} />
              <button className={`team-chip ${w.session?.role ?? ''}`} onClick={() => w.session && selectAndReveal(w.session.id)} title={w.session ? 'Show this session' : 'Removed'}>
                {w.session?.title ?? '(removed)'}
              </button>
              <span className="work-task ellipsis" title={firstLine(w.node.item)}>{firstLine(w.node.item)}</span>
              <span className={`work-state ${w.state}`}>{STATE_LABEL[w.state]}</span>
              {w.state !== 'done' && w.session && <Activity session={w.session} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

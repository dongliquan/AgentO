import { useEffect } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { selectAndReveal } from '@/commands';
import { orderProgress, firstLine, type WorkItem } from '@/lib/progress';
import { orderStatus, type LogNode } from '@/lib/threads';
import { Activity } from './OrderProgress';

const STATE: Record<WorkItem['state'], { label: string; hint: string }> = {
  done: { label: 'Reported', hint: 'Finished and reported back' },
  replaced: { label: 'Sent again', hint: 'The same session got this work again later — the newer piece counts' },
  working: { label: 'Working', hint: 'On it right now' },
  waiting: { label: 'Waiting', hint: 'Idle without reporting back — it may need an answer or a decision' },
  stopped: { label: 'Stopped', hint: 'Stopped before reporting back — resume it, or ask where it stands' },
  error: { label: 'Error', hint: 'Exited with an error — resume or restart it' },
  removed: { label: 'Removed', hint: 'The session is gone — hand this piece to someone else' }
};

/** what needs the manager first: stuck, then waiting, working, and the finished ones last */
const RANK: Record<WorkItem['state'], number> = { stopped: 0, error: 0, removed: 1, waiting: 2, working: 3, done: 4, replaced: 5 };

const statusCheck = (it: InboxItem): string =>
  `Status check on this order — where does it stand? Reply briefly (done / in progress / blocked, and what is left).\n> ${firstLine(it).slice(0, 160)}`;

function ask(sessionId: string, node: LogNode): void {
  send({ type: 'team.order', target: { kind: 'session', sessionId }, text: statusCheck(node.item) });
}

/** The next step the manager has to take for this order — or none, when the team is on it. */
function nextStep(node: LogNode, items: WorkItem[], sessions: Map<string, Session>): { tone: 'ok' | 'wait' | 'act'; text: string } {
  const lead = sessions.get(node.item.sessionId);
  const st = orderStatus(node, sessions);
  const open = items.filter((w) => w.state !== 'done' && w.state !== 'replaced');
  const stuck = open.filter((w) => w.state === 'stopped' || w.state === 'error' || w.state === 'removed');
  const waiting = open.filter((w) => w.state === 'waiting');
  if (st === 'reported' && open.length === 0) return { tone: 'ok', text: 'Done — the result is in your reports (Manager tab).' };
  if (stuck.length) return { tone: 'act', text: `${stuck.length} piece${stuck.length > 1 ? 's' : ''} stopped before reporting back — Resume them, or Ask where they stand.` };
  if (waiting.length && !open.some((w) => w.state === 'working'))
    return { tone: 'act', text: `${waiting.map((w) => w.session?.title ?? '?').join(', ')} ${waiting.length > 1 ? 'are' : 'is'} idle without reporting — open it: it may be asking you something.` };
  if (open.length === 0) {
    if (lead && (lead.status === 'working' || lead.status === 'starting')) return { tone: 'wait', text: 'Every piece is back — the lead is putting the report together.' };
    return { tone: 'act', text: 'Every piece is back, but no report reached you yet — Ask the lead for it.' };
  }
  return { tone: 'wait', text: `${open.filter((w) => w.state === 'working').length} working — nothing for you to do yet.` };
}

/** Where an order stands: progress, each piece with its holder's state and current activity, and the next step. */
export function FlowStatus({ node }: { node: LogNode }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const connected = useStore((s) => s.connected);
  const p = orderProgress(node, sessions);
  const step = nextStep(node, p.items, sessions);
  const lead = sessions.get(node.item.sessionId);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  // the conversations of the sessions holding work, for "what it is doing now"
  const ids = [...new Set(p.items.map((w) => w.session?.id).filter((x): x is string => !!x))];
  useEffect(() => {
    if (connected) for (const id of ids) send({ type: 'chat.subscribe', id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, ids.join(',')]);

  return (
    <div className="flow-status">
      <div className={`flow-next ${step.tone}`}>
        <span className="flow-next-label">{step.tone === 'act' ? 'Next step' : step.tone === 'ok' ? 'Done' : 'Status'}</span>
        <span className="grow">{step.text}</span>
        {step.tone === 'act' && lead && /Ask the lead/.test(step.text) && (
          <button className="btn sm" onClick={() => ask(lead.id, node)}>Ask the lead</button>
        )}
      </div>
      <div className="flow-progress">
        <span className="bar"><span style={{ width: `${pct}%` }} /></span>
        <span>{p.done}/{p.total} {p.total === 1 ? 'piece' : 'pieces'} reported</span>
      </div>
      <ul className="flow-pieces">
        {[...p.items].sort((a, b) => RANK[a.state] - RANK[b.state] || b.node.item.createdAt - a.node.item.createdAt).map((w) => {
          const s = w.session;
          const stopped = w.state === 'stopped' || w.state === 'error';
          return (
            <li key={w.node.item.id} className={`flow-piece ${w.state}`}>
              <span className={`flow-state ${w.state}`} title={STATE[w.state].hint}>{STATE[w.state].label}</span>
              <button className="flow-piece-who ellipsis" onClick={() => s && selectAndReveal(s.id)} title={s ? `Show ${s.title}` : undefined}>
                {s?.title ?? '(removed)'}
              </button>
              <span className="flow-piece-what ellipsis" title={firstLine(w.node.item)}>{firstLine(w.node.item)}</span>
              {s && w.state !== 'done' && w.state !== 'replaced' ? (
                <span className="flow-piece-now">
                  <Activity session={s} />
                </span>
              ) : (
                <span />
              )}
              <span className="flow-piece-acts">
                {s && stopped && <button className="btn sm primary" onClick={() => send({ type: 'session.resume', id: s.id })}>Resume</button>}
                {s && w.state !== 'done' && w.state !== 'replaced' && w.state !== 'working' && <button className="btn sm" onClick={() => ask(s.id, w.node)}>Ask status</button>}
                {s && w.state === 'waiting' && <button className="btn sm" onClick={() => selectAndReveal(s.id)}>Open</button>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

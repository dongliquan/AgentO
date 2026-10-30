import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { useOpenInbox, threadsOf } from '@/lib/closed';
import { descendants, type LogNode } from '@/lib/threads';
import { kindSlug, msgKind, type MsgKind } from '@/lib/msgKind';
import { MsgTag } from './MsgTag';
import { formatDateTime } from '@/lib/format';
import { CopyButton } from './SearchBox';
import { renderMarkdown } from '@/lib/markdown';
import { FlowStatus } from './FlowStatus';
import { statusClass, statusLabel } from '@/lib/format';

/** Which order's flow is open (an inbox id of the manager's order), shared by every OrderCard's Flow button. */
export const useFlow = create<{ orderId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  orderId: null,
  open: (id) => set({ orderId: id }),
  close: () => set({ orderId: null })
}));

interface Step {
  item: InboxItem;
  from: string;
  to: string;
  kind: 'directive' | 'report';
  /** what the message is (order · task · ask · report · finished · handed on): the tag and the line's color */
  tag: MsgKind;
}

/** "<from> → <to>: body" → body, one line. */
function gist(it: InboxItem): string {
  const i = it.text.indexOf(': ');
  const body = (i >= 0 ? it.text.slice(i + 2) : it.text).replace(/^\[Order from [^\]]*\]\s*/, '');
  return body.split('\n').find((l) => l.trim())?.trim() ?? '';
}
/** "finished" / "replied" / "stopped (…)": the daemon's word for how a piece came back, shown as a badge */
function outcome(it: InboxItem): string | null {
  return /^(finished|replied|stopped \([^)]*\)):/.exec(full(it))?.[1] ?? null;
}
/** the message without that word (and without an order's "[Order from …]" header) */
function body(it: InboxItem): string {
  return full(it).replace(/^(finished|replied|stopped \([^)]*\)):\s*/, '').replace(/^\[Order from [^\]]*\]\s*/, '');
}
function full(it: InboxItem): string {
  const i = it.text.indexOf(': ');
  return (i >= 0 ? it.text.slice(i + 2) : it.text).trim();
}

/**
 * Who sent what to whom: a directive goes from its sender (fromId) to its session; a report to the manager is filed
 * under its sender (fromId === sessionId), any other report under the session it went to.
 */
function stepOf(it: InboxItem): Step {
  const kind = it.kind === 'report' ? 'report' : 'directive';
  const from = it.fromId ?? 'user';
  const to = kind === 'report' && it.fromId === it.sessionId ? 'user' : it.sessionId;
  return { item: it, from, to, kind, tag: msgKind(it) };
}

const LANE_W = 150;
/** room for the lane heads (name + status, two lines) above the first arrow */
const HEAD_H = 66;
const ROW_H = 46;
const PAD_X = 20;

const roleClass = (s: Session | undefined): string => (!s ? 'removed' : s.role === 'head' ? 'head' : s.role === 'coach' ? 'coach' : 'player');

/**
 * An order as a sequence diagram: one lane per party (the manager, then sessions as they join), one arrow per message
 * in time order — directives down the chain (blue), reports back up (pink). Click an arrow for the whole message.
 */
export function OrderFlowDialog(): JSX.Element | null {
  const orderId = useFlow((s) => s.orderId);
  const close = useFlow((s) => s.close);
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [orderId]);
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderId, close]);

  const node: LogNode | undefined = useMemo(() => (orderId ? threadsOf(inbox).find((t) => t.item.id === orderId) : undefined), [inbox, orderId]);
  const steps = useMemo(() => (node ? [node.item, ...descendants(node)].sort((a, b) => a.createdAt - b.createdAt).map(stepOf) : []), [node]);
  const lanes = useMemo(() => {
    const out = ['user'];
    for (const s of steps) for (const id of [s.from, s.to]) if (!out.includes(id)) out.push(id);
    return out;
  }, [steps]);
  if (!orderId) return null;

  // a "handed on" arrow answers the order it came for — but it is drawn after the work the session handed out, so it reads
  // as the next step: it says which pieces it sent meanwhile ("→ #T33")
  const sentWith = (i: number): string[] => {
    const a = steps[i]!;
    let since = 0;
    for (let k = i - 1; k >= 0; k--) if (steps[k]!.from === a.from && steps[k]!.kind === 'report') { since = steps[k]!.item.createdAt; break; }
    return steps.filter((s) => s.kind === 'directive' && s.from === a.from && s.item.taskId && s.item.createdAt > since && s.item.createdAt <= a.item.createdAt).map((s) => s.item.taskId!);
  };
  const x = (id: string): number => PAD_X + lanes.indexOf(id) * LANE_W + LANE_W / 2;
  const width = PAD_X * 2 + lanes.length * LANE_W;
  const height = HEAD_H + steps.length * ROW_H + 24;
  const label = (id: string): string => (id === 'user' ? 'Manager (you)' : sessions.get(id)?.title ?? '(removed session)');
  const sel = steps.find((s) => s.item.id === picked) ?? steps[steps.length - 1];
  // the latest directive each session got, and whether it reported after it: still working on it?
  const pending = new Set<string>();
  for (const s of steps) {
    if (s.kind === 'directive') pending.add(s.to);
    else pending.delete(s.from);
  }

  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog flow-dialog" role="dialog" aria-label="Order flow">
        <div className="flow-head">
          <h3>Order flow</h3>
          <span className="muted ellipsis">{node ? gist(node.item) : 'This order is no longer in the log.'}</span>
          <button className="icon-btn dialog-x" onClick={close} title="Close (Esc)" aria-label="Close">×</button>
        </div>
        <div className="flow-legend muted">
          <span><MsgTag kind="order" /><MsgTag kind="task" /> down the chain</span>
          <span><MsgTag kind="ask" /> a question</span>
          <span><MsgTag kind="report" /><MsgTag kind="finished" /> back up</span>
          <span><MsgTag kind="handed on" /> no result yet</span>
          <span><i className="flow-dot pending" /> still on it</span>
          <span>{steps.length} message{steps.length === 1 ? '' : 's'}</span>
        </div>
        {node && <FlowStatus node={node} />}
        <div className="flow-canvas">
          <div className="flow-inner" style={{ width, height }}>
            {lanes.map((id) => {
              const s = id === 'user' ? undefined : sessions.get(id);
              const busy = s && (s.status === 'working' || s.status === 'starting');
              return (
                <div
                  key={id}
                  className={`flow-lane-head team-chip ${id === 'user' ? 'manager' : roleClass(s)}`}
                  style={{ left: x(id) - LANE_W / 2 + 6, width: LANE_W - 12 }}
                  title={label(id)}
                  onClick={() => s && selectAndReveal(s.id)}
                >
                  <span className="flow-lane-name">
                    {pending.has(id) && <span className={`flow-dot pending ${busy ? 'busy' : ''}`} title={busy ? 'Working on it' : 'Has not reported back yet'} />}
                    <span className="ellipsis">{label(id)}</span>
                  </span>
                  {s && <span className={`flow-lane-st ${statusClass(s)}`}>{statusLabel(s)}</span>}
                </div>
              );
            })}
            <svg className="flow-svg" width={width} height={height} aria-hidden="true">
              <defs>
                <marker id="flow-arrow-d" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="flow-head-d" />
                </marker>
                <marker id="flow-arrow-r" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="flow-head-r" />
                </marker>
              </defs>
              {lanes.map((id) => (
                <line key={id} x1={x(id)} x2={x(id)} y1={HEAD_H - 8} y2={height - 8} className="flow-lifeline" />
              ))}
              {steps.map((s, i) => {
                const y = HEAD_H + i * ROW_H + ROW_H / 2 + 6;
                const x1 = x(s.from);
                const x2 = x(s.to);
                const self = x1 === x2;
                const d = self ? `M${x1},${y - 8} h28 v16 h-26` : `M${x1},${y} L${x2 + (x2 > x1 ? -4 : 4)},${y}`;
                return (
                  <g key={s.item.id} className={`flow-step ${s.kind} k-${kindSlug(s.tag)} ${sel?.item.id === s.item.id ? 'on' : ''}`} onClick={() => setPicked(s.item.id)}>
                    <path d={d} className="flow-hit" />
                    <path d={d} className="flow-line" markerEnd={`url(#flow-arrow-${s.kind === 'report' ? 'r' : 'd'})`} />
                  </g>
                );
              })}
            </svg>
            {steps.map((s, i) => {
              const y = HEAD_H + i * ROW_H + 2;
              const x1 = x(s.from);
              const x2 = x(s.to);
              const left = Math.min(x1, x2) + 6;
              const w = Math.max(LANE_W - 12, Math.abs(x2 - x1) - 12);
              return (
                <button
                  key={s.item.id}
                  className={`flow-label ${s.kind} k-${kindSlug(s.tag)} ${sel?.item.id === s.item.id ? 'on' : ''}`}
                  style={{ left, top: y, width: w }}
                  title={`${formatDateTime(s.item.createdAt)}\n${gist(s.item)}`}
                  onClick={() => setPicked(s.item.id)}
                >
                  <MsgTag kind={s.tag} taskId={s.item.taskId} />
                  {s.tag === 'handed on' && sentWith(i).length > 0 && <b className="flow-sent" title="The work it handed out meanwhile">→ {sentWith(i).join(' ')} </b>}
                  {gist(s.item).replace(/^\(report\)\s*/, '').replace(/^(?:finished|replied|stopped|handed on)(?: \([^)]*\))?:\s*/, '') || '(empty)'}
                </button>
              );
            })}
          </div>
        </div>
        {sel && (
          <div className="flow-detail">
            <div className="flow-detail-head">
              <span className={`team-chip ${sel.from === 'user' ? 'manager' : roleClass(sessions.get(sel.from))}`}>{label(sel.from)}</span>
              <MsgTag kind={sel.tag} taskId={sel.item.taskId} />
              <span className="muted">{sel.kind === 'report' ? 'reported to' : 'sent to'}</span>
              <span className={`team-chip ${sel.to === 'user' ? 'manager' : roleClass(sessions.get(sel.to))}`}>{label(sel.to)}</span>
              {outcome(sel.item) && <span className={`flow-outcome ${outcome(sel.item)!.split(' ')[0]}`}>{outcome(sel.item)}</span>}
              <span className="muted grow">{formatDateTime(sel.item.createdAt)}</span>
              <CopyButton text={full(sel.item)} title="Copy this message" />
            </div>
            {/* renderMarkdown escapes all text; only its own tags are emitted */}
            <div className="flow-detail-text md chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(body(sel.item)) }} />
          </div>
        )}
      </div>
    </div>
  );
}

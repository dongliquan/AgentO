import { useEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useNow } from '@/lib/hooks';
import { matches, useHighlight } from '@/lib/search';
import { useOpenInbox } from '@/lib/closed';
import { TeamFeedItem } from './TeamFeedItem';
import { OrderCard } from './MyOrders';
import { SearchBox } from './SearchBox';

import { buildThreads, count, descendants, prune, withManager, type LogNode } from '@/lib/threads';

/** Expand / collapse every thread at once: a new nonce re-applies `open` to each node. */
interface Bulk {
  open: boolean;
  nonce: number;
}

function Thread({ node, depth, query, bulk, defaultOpen }: { node: LogNode; depth: number; query: string; bulk: Bulk; defaultOpen: boolean }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const now = useNow(15000);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (bulk.nonce) setOpen(bulk.open);
  }, [bulk]);
  const searching = query.trim() !== '';
  const shown = open || searching; // search results always show the path to each match
  const n = count(node);
  return (
    <div className={`log-node depth-${Math.min(depth, 4)}`}>
      <TeamFeedItem item={node.item} sessions={sessions} now={now} query={query} />
      {n > 0 && !searching && (
        <button className="log-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾ Hide' : '▸ Show'} {n} team message{n > 1 ? 's' : ''}
        </button>
      )}
      {shown && node.children.length > 0 && (
        <div className="log-children">
          {node.children.map((c) => (
            <Thread key={c.item.id} node={c} depth={depth + 1} query={query} bulk={bulk} defaultOpen={depth < 2} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Manager view of a thread: the order and the reports back to the user; the team traffic in between on demand. */
/** latest: the newest order, shown in full */
function ManagerThread({ node, query, bulk, latest = false }: { node: LogNode; query: string; bulk: Bulk; latest?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (bulk.nonce) setOpen(bulk.open);
  }, [bulk]);
  const all = descendants(node);
  const toUser = all.filter(withManager);
  const team = all.length - toUser.length;
  return (
    // the same card as Orders › My Orders; expanded, the whole thread (head coach → coaches → players) replaces the ↳ reports
    <OrderCard node={node} query={query} latest={latest} showProject hideReports={open}>
      {team > 0 && (
        <button className="log-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾ Hide' : '▸ Show'} {team} team message{team > 1 ? 's' : ''} in between
        </button>
      )}
      {open && (
        <div className="log-children">
          {node.children.map((c) => (
            <Thread key={c.item.id} node={c} depth={1} query={query} bulk={bulk} defaultOpen />
          ))}
        </div>
      )}
    </OrderCard>
  );
}

/** Expand all: chevrons pointing apart · collapse all: chevrons pointing together. */
function ExpandIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? <path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" /> : <path d="M4.5 2.5 8 6 11.5 2.5M4.5 13.5 8 10 11.5 13.5" />}
    </svg>
  );
}

export function TeamLog(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const [query, setQuery] = useState('');
  const [bulk, setBulk] = useState<Bulk>({ open: false, nonce: 0 });
  const [shown, setShown] = useState(15);
  const body = useRef<HTMLDivElement>(null);

  const threads = useMemo(() => buildThreads(inbox).reverse(), [inbox]);
  const titleOf = (id: string | undefined, map: Map<string, Session>): string | undefined =>
    id === 'user' ? 'Manager (you)' : id ? map.get(id)?.title : undefined;
  const searching = query.trim() !== '';
  const visible = useMemo(() => {
    if (!searching) return threads;
    const hit = (it: InboxItem): boolean => matches(query, it.text, titleOf(it.fromId, sessions), titleOf(it.sessionId, sessions));
    return threads.map((t) => prune(t, hit)).filter((t): t is LogNode => t !== null);
  }, [threads, query, searching, sessions]);
  const hits = useMemo(() => (searching ? visible.reduce((sum, t) => sum + 1 + count(t), 0) : undefined), [visible, searching]);
  useHighlight(body, query, [visible, bulk, shown]);


  return (
    <div className="rp-body log-body" ref={body}>
      <div className="log-bar">
        <SearchBox value={query} onChange={setQuery} count={hits} placeholder="Search the log" />
        <button className="icon-btn" onClick={() => setBulk({ open: true, nonce: Date.now() })} title="Expand all — the team messages under every order" aria-label="Expand all">
          <ExpandIcon open />
        </button>
        <button className="icon-btn" onClick={() => setBulk({ open: false, nonce: Date.now() })} title="Collapse all — your orders and the reports to you" aria-label="Collapse all">
          <ExpandIcon open={false} />
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{searching ? 'No matches.' : 'No team messages yet.'}</div>
      ) : (
        <>
          {visible.slice(0, shown).map((t, i) =>
            !searching ? (
              <ManagerThread key={t.item.id} node={t} query={query} bulk={bulk} latest={i === 0} />
            ) : (
              <Thread key={t.item.id} node={t} depth={0} query={query} bulk={bulk} defaultOpen />
            )
          )}
          {visible.length > shown && (
            <button className="btn sm ghost" onClick={() => setShown(shown + 15)}>
              Show older ({visible.length - shown})
            </button>
          )}
        </>
      )}
    </div>
  );
}

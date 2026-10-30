import { useMemo, useRef, useState } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { useNow } from '@/lib/hooks';
import { matches, useHighlight } from '@/lib/search';
import { useOpenInbox, threadsOf } from '@/lib/closed';
import { TeamFeedItem } from './TeamFeedItem';
import { OrderCard } from './MyOrders';
import { SearchBox } from './SearchBox';
import { ProjectFilter, useProjectFilter } from './ProjectFilter';
import { useTalkProject } from '@/lib/talkFilter';
import { RECENT_MS, RecentToggle, useRecentOnly } from './RecentToggle';

import { count, descendants, prune, withManager, type LogNode } from '@/lib/threads';

function Thread({ node, depth, query, defaultOpen }: { node: LogNode; depth: number; query: string; defaultOpen: boolean }): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const now = useNow(15000);
  const [open, setOpen] = useState(defaultOpen);
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
            <Thread key={c.item.id} node={c} depth={depth + 1} query={query} defaultOpen={depth < 2} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Manager view of a thread: the order and the reports back to the user; the team traffic in between on demand. */
/** latest: the newest order, shown in full */
function ManagerThread({ node, query, latest = false, showProject }: { node: LogNode; query: string; latest?: boolean; showProject: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const all = descendants(node);
  const toUser = all.filter(withManager);
  const team = all.length - toUser.length;
  return (
    // the same card as Orders › My Orders; expanded, the whole thread (head coach → coaches → players) replaces the ↳ reports
    <OrderCard node={node} query={query} latest={latest} showProject={showProject} hideReports={open}>
      {team > 0 && (
        <button className="log-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾ Hide' : '▸ Show'} {team} team message{team > 1 ? 's' : ''} in between
        </button>
      )}
      {open && (
        <div className="log-children">
          {node.children.map((c) => (
            <Thread key={c.item.id} node={c} depth={1} query={query} defaultOpen />
          ))}
        </div>
      )}
    </OrderCard>
  );
}

export function TeamLog(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(15);
  // the project filter is shared with the Manager tab and the Inbox
  const pick = useTalkProject((s) => s.project);
  const setPick = useTalkProject((s) => s.setProject);
  const { only, rootOf } = useProjectFilter(pick);
  const body = useRef<HTMLDivElement>(null);

  // a thread belongs to the project of the session its order went to; by default the last 7 days (by its last record)
  const [recentOnly, setRecentOnly] = useRecentOnly();
  const scoped = useMemo(
    () => [...threadsOf(inbox)].reverse().filter((t) => !only || rootOf(t.item.sessionId) === only),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inbox, only, sessions]
  );
  const threads = useMemo(() => {
    if (!recentOnly) return scoped;
    const cutoff = Date.now() - RECENT_MS;
    return scoped.filter((t) => lastAt(t) >= cutoff);
  }, [scoped, recentOnly]);
  const older = scoped.length - threads.length;
  const titleOf = (id: string | undefined, map: Map<string, Session>): string | undefined =>
    id === 'user' ? 'Manager' : id ? map.get(id)?.title : undefined;
  const searching = query.trim() !== '';
  const visible = useMemo(() => {
    if (!searching) return threads;
    const hit = (it: InboxItem): boolean => matches(query, it.text, titleOf(it.fromId, sessions), titleOf(it.sessionId, sessions));
    return threads.map((t) => prune(t, hit)).filter((t): t is LogNode => t !== null);
  }, [threads, query, searching, sessions]);
  const hits = useMemo(() => (searching ? visible.reduce((sum, t) => sum + 1 + count(t), 0) : undefined), [visible, searching]);
  useHighlight(body, query, [visible, shown]);


  return (
    <div className="rp-pane">
      <div className="log-bar filter-bar">
        <ProjectFilter value={pick} onChange={(id) => { setPick(id); setShown(15); }} />
        <RecentToggle value={recentOnly} onChange={setRecentOnly} hidden={older} />
        <SearchBox value={query} onChange={setQuery} count={hits} placeholder="Search the log" />
      </div>
      <div className="rp-body log-body" ref={body}>
      {visible.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{searching ? 'No matches.' : 'No team messages yet.'}</div>
      ) : (
        <>
          {visible.slice(0, shown).map((t, i) =>
            !searching ? (
              <ManagerThread key={t.item.id} node={t} query={query} latest={i === 0} showProject={!only} />
            ) : (
              <Thread key={t.item.id} node={t} depth={0} query={query} defaultOpen />
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
    </div>
  );
}

/** A thread's newest record (an old order still being answered counts as recent). */
function lastAt(n: LogNode): number {
  return Math.max(n.item.createdAt, ...n.children.map(lastAt));
}

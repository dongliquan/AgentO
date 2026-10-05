import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { InboxItem } from '@shared/protocol';
import { useStore } from '@/store';
import { useNow } from '@/lib/hooks';
import { matches, useHighlight } from '@/lib/search';
import { useOpenInbox, threadsOf } from '@/lib/closed';
import { count, descendants, orderStatus, prune, withManager, type LogNode, type OrderStatus } from '@/lib/threads';
import { TeamFeedItem } from './TeamFeedItem';
import { pcStyle, projectColor } from '@/lib/format';
import { SearchBox } from './SearchBox';
import { OrderProgress } from './OrderProgress';

const SHOWN = 5;

const STATUS: Record<OrderStatus, { label: string; title: string }> = {
  reported: { label: 'Reported', title: 'A report came back to you' },
  working: { label: 'In progress', title: 'The session that took the order is working on it' },
  waiting: { label: 'Waiting', title: 'Idle without a report yet — it may need an answer (see Inbox) or a nudge' },
  stopped: { label: 'Stopped', title: 'The session is not running' },
  error: { label: 'Error', title: 'The session failed' },
  removed: { label: 'Removed', title: 'The session was removed' }
};

/**
 * One order as a card: its status (for the manager's own orders), the project it went to, the order, the reports
 * back to the manager (↳), and below whatever the caller puts for the team's messages in between.
 * hideReports: the caller shows the whole thread instead (Log, expanded).
 */
export function OrderCard({
  node,
  query,
  latest = false,
  showProject = false,
  hideReports = false,
  children
}: {
  node: LogNode;
  query: string;
  latest?: boolean;
  showProject?: boolean;
  hideReports?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(15000);
  const mine = node.item.fromId === 'user';
  const st = orderStatus(node, sessions);
  const reports = descendants(node).filter((it) => it.kind === 'report' && withManager(it));
  const to = sessions.get(node.item.sessionId);
  const own = to ? projects.find((p) => p.id === to.projectId) : undefined;
  const root = own?.parentId ? projects.find((p) => p.id === own.parentId) : own;
  return (
    <div className="order-thread">
      {(mine || (showProject && root)) && (
        <div className="order-head">
          {mine && (
            <span className={`order-status ${st}`} title={STATUS[st].title}>
              <span className="dot" />
              {STATUS[st].label}
            </span>
          )}
          {showProject && root && <span className="project-tag" style={pcStyle(projectColor(root.id, projects))} title={root.name}>{root.name}</span>}
        </div>
      )}
      <TeamFeedItem item={node.item} sessions={sessions} now={now} query={query} defaultOpen={latest} />
      {mine && <OrderProgress node={node} open={latest} />}
      {!hideReports && reports.length > 0 && (
        <div className="order-reports">
          {reports.map((it) => (
            <div key={it.id} className="order-report">
              <TeamFeedItem item={it} sessions={sessions} now={now} query={query} defaultOpen={latest && it === reports[reports.length - 1]} />
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Orders tab, below the form: the manager's own recent orders, each with where it stands and the reports that came
 * back to the manager. The team's messages in between are only counted here — the Log tab shows them.
 * projectIds: only orders to sessions of these projects / parts (one project's tab).
 */
export function MyOrders({ projectIds }: { projectIds?: Set<string> }): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const setRightTab = useStore((s) => s.setRightTab);
  const [query, setQuery] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== '';

  const titleOf = (id?: string): string | undefined => (id === 'user' ? 'Manager (you)' : id ? sessions.get(id)?.title : undefined);
  const orders = useMemo(() => {
    const mine = threadsOf(inbox)
      .filter((t) => t.item.fromId === 'user')
      .filter((t) => !projectIds || projectIds.has(sessions.get(t.item.sessionId)?.projectId ?? ''))
      .reverse();
    if (!searching) return mine;
    const hit = (it: InboxItem): boolean => matches(query, it.text, titleOf(it.fromId), titleOf(it.sessionId));
    return mine.map((t) => prune(t, hit)).filter((t): t is LogNode => t !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, query, sessions, projectIds]);
  const shown = orders.slice(0, searching ? 30 : SHOWN);
  useHighlight(body, query, [shown]);

  return (
    <div className="rp-section my-orders" ref={body}>
      <h4 className="row" style={{ justifyContent: 'space-between' }}>
        <span>My Orders</span>
        <button className="btn sm ghost" onClick={() => setRightTab('log')}>Open full log →</button>
      </h4>
      <SearchBox value={query} onChange={setQuery} count={searching ? orders.length : undefined} placeholder="Search your orders and reports" />
      {shown.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{searching ? 'No matches.' : 'No orders yet.'}</div>
      ) : (
        shown.map((t, i) => {
          const reports = descendants(t).filter((it) => it.kind === 'report' && withManager(it));
          const team = count(t) - reports.length;
          return (
            <OrderCard key={t.item.id} node={t} query={query} latest={i === 0}>
              {team > 0 && (
                <button className="log-toggle" onClick={() => setRightTab('log')} title="The team's messages for this order are in the Log tab">
                  {team} team message{team > 1 ? 's' : ''} in between — open Log →
                </button>
              )}
            </OrderCard>
          );
        })
      )}
      {!searching && orders.length > SHOWN && (
        <button className="btn sm ghost" onClick={() => setRightTab('log')}>
          {orders.length - SHOWN} older order{orders.length - SHOWN > 1 ? 's' : ''} in the Log →
        </button>
      )}
    </div>
  );
}

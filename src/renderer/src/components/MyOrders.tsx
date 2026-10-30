import { type ReactNode } from 'react';
import { useStore } from '@/store';
import { useNow } from '@/lib/hooks';
import { descendants, orderStatus, withManager, type LogNode, type OrderStatus } from '@/lib/threads';
import { TeamFeedItem } from './TeamFeedItem';
import { pcStyle, projectColor } from '@/lib/format';
import { useFlow } from './OrderFlow';
import { OrderProgress } from './OrderProgress';


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
  const openFlow = useFlow((s) => s.open);
  const st = orderStatus(node, sessions);
  const reports = descendants(node).filter((it) => it.kind === 'report' && withManager(it));
  const to = sessions.get(node.item.sessionId);
  const own = to ? projects.find((p) => p.id === to.projectId) : undefined;
  const root = own?.parentId ? projects.find((p) => p.id === own.parentId) : own;
  return (
    <div className={`order-thread ${mine ? `st-${st}` : ''}`}>
      {(mine || (showProject && root)) && (
        <div className="order-head">
          {mine && (
            <span className={`order-status ${st}`} title={STATUS[st].title}>
              <span className="dot" />
              {STATUS[st].label}
            </span>
          )}
          {showProject && root && <span className="project-tag" style={pcStyle(projectColor(root.id, projects))} title={root.name}>{root.name}</span>}
          {mine && (
            <button className="btn sm ghost flow-btn" onClick={() => openFlow(node.item.id)} title="Flow — who passed this order to whom, as a diagram">
              Flow
            </button>
          )}
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

import { useMemo } from 'react';
import { useStore } from '@/store';
import { runCommand, selectAndReveal } from '@/commands';
import { useOpenThreads } from '@/lib/closed';
import { isDirect, orderStatus } from '@/lib/threads';
import { firstLine, orderProgress } from '@/lib/progress';
import { pcStyle, projectColor } from '@/lib/format';
import { useDraft } from '@/lib/draft';

const SHOWN = 8;

/**
 * The manager's orders, above the projects they went to: a row that opens the Manager tab, folding out each project's
 * latest order with its progress and state.
 */
export function SidebarOrders(): JSX.Element {
  const threads = useOpenThreads();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const done = useStore((s) => s.doneOrders);
  const [open, setOpen] = useDraft('sidebar.orders.open', true);

  const orders = useMemo(() => {
    const rootOf = (sessionId: string): string | undefined => {
      const s = sessions.get(sessionId);
      const p = s ? projects.find((x) => x.id === s.projectId) : undefined;
      return p?.parentId ?? p?.id;
    };
    // the latest order of each project (orders without a project, e.g. to the team-wide head coach, count as one)
    const latest = new Map<string, (typeof threads)[number]>();
    for (const t of threads) {
      if (t.item.fromId !== 'user' || isDirect(t.item)) continue;
      const key = rootOf(t.item.sessionId) ?? '';
      const cur = latest.get(key);
      if (!cur || t.item.createdAt > cur.item.createdAt) latest.set(key, t);
    }
    return [...latest.values()]
      .map((t) => {
        const status = done[t.item.id] ? 'done' : orderStatus(t, sessions);
        const p = orderProgress(t, sessions);
        return { node: t, status, project: rootOf(t.item.sessionId), pct: p.total ? p.done / p.total : 0, pieces: p };
      })
      .sort((a, b) => b.node.item.createdAt - a.node.item.createdAt);
  }, [threads, sessions, projects, done]);
  const openCount = orders.filter((o) => o.status !== 'done' && o.status !== 'reported').length;

  return (
    <div className="sidebar-orders">
      <div className="tree-row sidebar-orders-head" onClick={() => runCommand('view.orders')} title="Orders — give the team an order; your orders and where they stand">
        <span
          className="caret"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? '▾' : '▸'}
        </span>
        <span className="label">Orders</span>
        {openCount > 0 && <span className="badge" title={`${openCount} open order${openCount > 1 ? 's' : ''}`}>{openCount}</span>}
      </div>
      {open && orders.length === 0 && <div className="tree-empty" style={{ paddingLeft: 26 }}>No orders yet.</div>}
      {open &&
        orders.slice(0, SHOWN).map(({ node, status, project, pct, pieces }) => {
          const p = projects.find((x) => x.id === project);
          const text = firstLine(node.item);
          return (
            <div
              key={node.item.id}
              className={`tree-row sidebar-order ${status}`}
              style={{ paddingLeft: 22 }}
              title={`${text}\n${pieces.total ? `${pieces.done}/${pieces.total} pieces reported · ` : ''}${status}`}
              onClick={() => {
                if (sessions.has(node.item.sessionId)) selectAndReveal(node.item.sessionId);
                runCommand('view.orders');
              }}
            >
              <span className={`order-dot ${status}`} />
              {p && (
                <span className="project-tag" style={pcStyle(projectColor(p.id, projects))}>
                  {p.name}
                </span>
              )}
              <span className="label ellipsis">{text}</span>
              {pieces.total > 1 && status !== 'done' && status !== 'reported' && <span className="muted order-pct">{Math.round(pct * 100)}%</span>}
            </div>
          );
        })}
      {open && orders.length > SHOWN && (
        <div className="tree-row tree-more" style={{ paddingLeft: 26 }} onClick={() => useStore.getState().setRightTab('log')}>
          {orders.length - SHOWN} more in the Log →
        </div>
      )}
    </div>
  );
}

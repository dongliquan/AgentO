import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { send } from '@/client';
import { useNow } from '@/lib/hooks';
import { useOpenInbox } from '@/lib/closed';
import { buildThreads, orderStatus, type LogNode, type OrderStatus } from '@/lib/threads';
import { pcStyle, projectColor, relativeTime, formatDateTime } from '@/lib/format';
import { OrderCard } from './MyOrders';
import { useDraft } from '@/lib/draft';
import { imageFiles, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachButton, AttachmentBar } from './AttachmentBar';

type TaskStatus = OrderStatus | 'done';
type Filter = 'open' | 'done' | 'all';

const LABEL: Record<TaskStatus, string> = {
  reported: 'Reported',
  working: 'In progress',
  waiting: 'Waiting',
  stopped: 'Stopped',
  error: 'Error',
  removed: 'Removed',
  done: 'Done'
};
const HINT: Record<TaskStatus, string> = {
  reported: 'A report came back — review it, then mark it done',
  working: 'The session that took it is working on it',
  waiting: 'Idle without a report — it may need an answer (Inbox) or a nudge (Ask status)',
  stopped: 'The session is not running — Ask status starts it',
  error: 'The session failed',
  removed: 'The session that took it was removed',
  done: 'You marked it done'
};
/** what needs the manager first: reports to review, stalled orders, then running ones */
const ORDER: TaskStatus[] = ['reported', 'waiting', 'error', 'stopped', 'working', 'removed', 'done'];

/** The order's own words: the record reads "<from> → <to>: <message>". */
function orderText(text: string): string {
  const i = text.indexOf(': ');
  return i >= 0 ? text.slice(i + 2) : text;
}

/**
 * A new task: an order to one project (its head coach, or its lead without one). It shows up in the list as soon as
 * the daemon records it.
 */
function NewTask({ defaultProject }: { defaultProject?: string }): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const setRightTab = useStore((s) => s.setRightTab);
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  const [pid, setPid] = useDraft('tasks.project', defaultProject ?? tops[0]?.id ?? '');
  const [text, setText] = useDraft('tasks.text', '');
  const files = useAttachments();
  const project = tops.find((p) => p.id === pid) ?? tops[0];
  const hasTaker = !!project && [...sessions.values()].some((s) => s.projectId === project.id || projects.some((x) => x.parentId === project.id && x.id === s.projectId));
  const can = !!project && hasTaker && text.trim() !== '' && !files.busy;
  const submit = (): void => {
    if (!can) return;
    send({ type: 'team.order', target: { kind: 'project', projectId: project.id }, text: withAttachments(text.trim(), files.items) });
    setText('');
    files.clear();
  };
  if (tops.length === 0) {
    return (
      <div className="new-task muted">
        No project yet — <button className="btn sm ghost" onClick={() => setRightTab('orders')}>start one in Orders › ＋ New</button>
      </div>
    );
  }
  return (
    <div className="new-task">
      <div className="new-task-to">
        {tops.map((p) => (
          <button key={p.id} className={`project-tag ${project?.id === p.id ? 'on' : ''}`} style={pcStyle(projectColor(p.id, projects))} onClick={() => setPid(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        rows={2}
        placeholder={hasTaker ? `New task for ${project?.name} — Ctrl+Enter. Paste or drop images.` : `${project?.name} has no sessions yet: add a head coach first`}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const imgs = imageFiles(e.clipboardData);
          if (imgs.length) {
            e.preventDefault();
            files.add(imgs);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const imgs = imageFiles(e.dataTransfer);
          if (imgs.length) {
            e.preventDefault();
            files.add(imgs);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <AttachmentBar items={files.items} onRemove={files.remove} />
      <div className="row">
        <AttachButton onFiles={files.add} />
        <span className="grow" />
        <button className="btn sm primary" disabled={!can} onClick={submit}>Add Task</button>
      </div>
    </div>
  );
}

/** A follow-up on a task: sent to the session that took it; it becomes its own task, linked by its first line. */
function FollowUp({ node }: { node: LogNode }): JSX.Element {
  const [text, setText] = useState('');
  const go = (): void => {
    if (!text.trim()) return;
    const first = orderText(node.item.text).split('\n')[0]!.slice(0, 120);
    send({ type: 'team.order', target: { kind: 'session', sessionId: node.item.sessionId }, text: `${text.trim()}\n\n(Follow-up on: ${first})` });
    setText('');
  };
  return (
    <div className="task-follow">
      <input
        value={text}
        placeholder="Follow-up for this task — Enter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            go();
          }
        }}
      />
      <button className="btn sm" disabled={!text.trim()} onClick={go}>Send</button>
    </div>
  );
}

/**
 * The manager's task list: every order the manager gave (all open projects, routine runs included), what became of
 * it, and whether the manager has closed it. Mark done after reviewing the report; Ask status nudges the session.
 */
export function TaskList(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const done = useStore((s) => s.doneOrders);
  const now = useNow(15000);
  const [filter, setFilter] = useState<Filter>('open');
  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const rootOf = (sessionId: string): string | undefined => {
    const s = sessions.get(sessionId);
    const p = s ? projects.find((x) => x.id === s.projectId) : undefined;
    return p?.parentId ?? p?.id;
  };
  const tasks = useMemo(() => {
    const list = buildThreads(inbox)
      .filter((t) => t.item.fromId === 'user')
      .map((t) => ({ node: t, status: (done[t.item.id] ? 'done' : orderStatus(t, sessions)) as TaskStatus, project: rootOf(t.item.sessionId) }));
    return list.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.node.item.createdAt - a.node.item.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, sessions, projects, done]);
  const counts = { open: tasks.filter((t) => t.status !== 'done').length, done: tasks.filter((t) => t.status === 'done').length, all: tasks.length };
  const shown = tasks.filter((t) => (filter === 'all' || (filter === 'done') === (t.status === 'done')) && (!only || t.project === only));
  const withTasks = projects.filter((p) => !p.parentId && tasks.some((t) => t.project === p.id));

  const askStatus = (t: LogNode): void => {
    const first = orderText(t.item.text).split('\n')[0]!.slice(0, 160);
    send({
      type: 'team.order',
      target: { kind: 'session', sessionId: t.item.sessionId },
      text: `Status check on this order — where does it stand? Reply briefly (done / in progress / blocked, and what is left).\n> ${first}`
    });
  };

  return (
    <div className="rp-body tasks">
      <NewTask defaultProject={only ?? undefined} />
      <div className="task-filters">
        {(['open', 'done', 'all'] as Filter[]).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'All'} <span className="n">{counts[f]}</span>
          </button>
        ))}
        <span className="grow" />
      </div>
      {withTasks.length > 1 && (
        <div className="task-projects">
          {withTasks.map((p) => (
            <button
              key={p.id}
              className={`project-tag ${only === p.id ? 'on' : ''}`}
              style={pcStyle(projectColor(p.id, projects))}
              onClick={() => setOnly(only === p.id ? null : p.id)}
              title={only === p.id ? 'Show every project' : `Only ${p.name}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{filter === 'open' ? 'Nothing open — every order is done.' : 'No orders here.'}</div>
      ) : (
        <div className="task-list">
          {shown.map(({ node, status, project }) => {
            const p = projects.find((x) => x.id === project);
            const expanded = open === node.item.id;
            const text = orderText(node.item.text);
            const to = sessions.get(node.item.sessionId);
            return (
              <div key={node.item.id} className={`task ${status} ${expanded ? 'open' : ''}`}>
                <div className="task-row" onClick={() => setOpen(expanded ? null : node.item.id)}>
                  <span className={`order-status ${status}`} title={HINT[status]}>
                    <span className="dot" />
                    {LABEL[status]}
                  </span>
                  {p && (
                    <span className="project-tag" style={pcStyle(projectColor(p.id, projects))}>
                      {p.name}
                    </span>
                  )}
                  <span className="task-title" title={text}>{text.split('\n')[0]}</span>
                  <span className="time" title={formatDateTime(node.item.createdAt)}>{relativeTime(node.item.createdAt, now)}</span>
                </div>
                <div className="task-actions">
                  <span className="muted">→ {to?.title ?? '(removed session)'}</span>
                  <span className="grow" />
                  {status !== 'done' && to && (
                    <button className="btn sm ghost" onClick={() => askStatus(node)} title="Ask the session where this stands (wakes it if stopped)">
                      Ask status
                    </button>
                  )}
                  <button
                    className={`btn sm ${status === 'done' ? 'ghost' : ''}`}
                    onClick={() => send({ type: 'order.done', id: node.item.id, done: status !== 'done' })}
                    title={status === 'done' ? 'Open it again' : 'You reviewed it: close it'}
                  >
                    {status === 'done' ? 'Reopen' : '✓ Done'}
                  </button>
                </div>
                {expanded && (
                  <>
                    <OrderCard node={node} query="" latest />
                    {to && status !== 'done' && <FollowUp node={node} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

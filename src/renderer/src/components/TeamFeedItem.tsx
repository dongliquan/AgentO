import { useMemo, useState } from 'react';
import type { InboxItem, Session } from '@shared/protocol';
import { send } from '@/client';
import { selectAndReveal } from '@/commands';
import { formatDateTime, pcStyle, projectColor, relativeTime, roleLabel } from '@/lib/format';
import { useStore } from '@/store';
import { matches, selecting } from '@/lib/search';
import { CopyButton } from './SearchBox';
import { renderMarkdown } from '@/lib/markdown';

/** Chip for a sender/receiver: the manager (user), a session (role color), or a removed session. */
function Chip({ session, user }: { session?: Session; user?: boolean }): JSX.Element {
  const projects = useStore((st) => st.projects);
  if (user) return <span className="team-chip manager">Manager (you)</span>;
  if (!session) return <span className="team-chip">(removed)</span>;
  // the team-wide Head Coach in the manager's color, a project's Coach in its project's
  const cls = session.role === 'head' ? (session.projectId ? 'project' : 'manager') : session.role;
  return (
    <span className={`team-chip ${cls}`} style={cls === 'project' ? pcStyle(projectColor(session.projectId, projects)) : undefined} title={roleLabel(session)}>
      {session.title}
    </span>
  );
}

/**
 * One team-traffic record (directive or report): "from → to", time, and the message, clamped to a few lines.
 * The stored text is "<from title> → <to title>: <message>"; the chips come from fromId / sessionId instead.
 */
/** defaultOpen: shown in full from the start (the latest order) */
export function TeamFeedItem({ item: it, sessions, now, query = '', defaultOpen = false }: { item: InboxItem; sessions: Map<string, Session>; now: number; query?: string; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const target = sessions.get(it.sessionId);
  // Records addressed to the user are filed under the sender itself (fromId === sessionId): "<from> → Manager (you): …"
  // or "<from> replied|finished: …". Others read "<from> → <to>: …". Only the prefix is parsed — the message itself
  // may contain arrows and colons.
  const toUser = it.fromId === it.sessionId;
  const head = it.text.indexOf(': ');
  const arrow = head >= 0 ? it.text.lastIndexOf(' → ', head) : -1;
  const body = head >= 0 ? it.text.slice(head + 2) : it.text;
  const fromUser = it.fromId === 'user';
  const fromSession = fromUser ? undefined : sessions.get(it.fromId ?? (toUser ? it.sessionId : ''));
  const via = fromUser && arrow >= 0 ? it.text.slice(0, arrow).replace(/^Manager \(you\)( · )?/, '') : '';
  const long = body.length > 220;
  // rendered like a session card's conversation (headings, lists, code, bold)
  const html = useMemo(() => renderMarkdown(body), [body]);
  // a search hit may sit past the clamp, so a matching item shows in full
  const hit = query.trim() !== '' && matches(query, body);
  const fromName = fromUser ? 'Manager (you)' : fromSession?.title ?? '(removed)';
  const toName = toUser ? 'Manager (you)' : target?.title ?? '(removed)';
  const copy = (): string => `[${it.kind === 'directive' ? 'Order' : 'Report'}] ${fromName} → ${toName} · ${formatDateTime(it.createdAt)}
${body}`;
  return (
    <div className={`feed-item ${it.kind} ${it.read ? '' : 'unread'}`}>
      <div className="feed-head">
        <span className={`feed-kind ${it.kind}`}>{it.kind === 'directive' ? 'Order' : 'Report'}</span>
        <Chip user={fromUser} session={fromSession} />
        <span className="feed-arrow">→</span>
        {toUser ? <Chip user /> : <Chip session={target} />}
        <span className="grow" />
        <span className="time" title={formatDateTime(it.createdAt)}>{relativeTime(it.createdAt, now)}</span>
        <CopyButton text={copy} title="Copy this message" />
      </div>
      {via && <div className="feed-via">{via}</div>}
      <div
        className={`feed-body ${long && !open && !hit ? 'clamped' : ''}`}
        onClick={() => {
          if (selecting()) return; // the user is selecting text to copy
          if (!it.read) send({ type: 'inbox.read', id: it.id });
          const reveal = toUser ? fromSession?.id : target?.id;
          if (reveal) selectAndReveal(reveal);
        }}
        title="Click to open the session"
      >
        {/* renderMarkdown escapes all text; only its own tags are emitted */}
        <div className="md chat-md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {long && !hit && <button className="feed-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

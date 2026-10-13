import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InboxItem } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { useOpenInbox, threadsOf } from '@/lib/closed';
import { descendants, isDirect, orderStatus, withManager, type LogNode } from '@/lib/threads';
import { formatDateTime, pcStyle, projectColor, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useDraft } from '@/lib/draft';
import { matches, selecting, useHighlight } from '@/lib/search';
import { CopyButton, SearchBox } from './SearchBox';
import { renderMarkdown } from '@/lib/markdown';
import { ProjectFilter, useProjectFilter } from './ProjectFilter';
import { useFlow } from './OrderFlow';
import { useTalkProject } from '@/lib/talkFilter';

type Kind = 'all' | 'orders' | 'direct';
const KINDS: { id: Kind; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Orders and what you typed into sessions' },
  { id: 'orders', label: 'Orders', title: 'Orders from the Orders and Tasks tabs' },
  { id: 'direct', label: 'Direct', title: 'What you typed into a session yourself' }
];
const PAGE = 30;

/** "<from> → <to>: body" → body (an order also drops its "[Order from …]" header). */
function bodyOf(it: InboxItem): string {
  const i = it.text.indexOf(': ');
  return (i >= 0 ? it.text.slice(i + 2) : it.text).replace(/^\[Order from [^\]]*\]\s*/, '').trim();
}

/**
 * How one of the manager's messages reads here. Some orders are AgentO's own briefing, sent when the manager clicked
 * something (Organize Team) or a routine ran (auto: left out of this tab); a new project shows only the brief.
 */
function viewOf(it: InboxItem): { kind: string; text: string; auto: boolean } {
  const body = bodyOf(it);
  const sender = it.text.slice(0, Math.max(0, it.text.indexOf(' → ')));
  if (isDirect(it)) return { kind: 'Direct', text: body, auto: false };
  if (body.startsWith('[New project]')) {
    const brief = body.split('\nBrief from the manager:\n')[1]?.trim();
    // the template is AgentO's; the brief at its end is what the manager wrote
    return { kind: 'New project', text: brief ?? '', auto: !brief };
  }
  if (body.startsWith('[Organize the team]')) return { kind: 'Organize Team', text: 'AgentO asked the coach to sort the project’s sessions into parts.', auto: true };
  const via = /· (.+)$/.exec(sender)?.[1];
  if (via) return { kind: via, text: body, auto: true };
  return { kind: 'Order', text: body, auto: false };
}

const WAIT_LABEL: Record<string, string> = {
  working: 'Working on it…',
  waiting: 'Waiting — no answer yet',
  stopped: 'Stopped — no answer yet',
  error: 'Exited with an error',
  removed: 'The session was removed'
};

/**
 * What the manager typed themselves — orders and messages to a session, not AgentO's automatic briefings — as one
 * conversation: their message on the right, the answers that came back on the left. By project and kind, searchable.
 */
export function MyTalk(): JSX.Element {
  const inbox = useOpenInbox();
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(15000);
  const pick = useTalkProject((s) => s.project);
  const setPick = useTalkProject((s) => s.setProject);
  const [kind, setKind] = useDraft<Kind>('me.kind', 'all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const { only, rootOf } = useProjectFilter(pick);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const openFlow = useFlow((s) => s.open);

  const all = useMemo(
    () =>
      threadsOf(inbox)
        .filter((t) => t.item.fromId === 'user' && !viewOf(t.item).auto)
        .filter((t) => !only || rootOf(t.item.sessionId) === only)
        .filter((t) => kind === 'all' || (kind === 'direct') === isDirect(t.item)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inbox, only, kind, sessions]
  );
  const answersOf = (t: LogNode): InboxItem[] => descendants(t).filter((it) => it.kind === 'report' && withManager(it));
  const searching = query.trim() !== '';
  const titleOf = (id: string): string | undefined => sessions.get(id)?.title;
  const found = searching ? all.filter((t) => [t.item, ...answersOf(t)].some((it) => matches(query, it.text, titleOf(it.sessionId)))) : all;
  const hidden = Math.max(0, found.length - shown);
  const list = found.slice(hidden);
  useHighlight(body, query, [list]);

  // newest at the bottom, like a messenger: stay pinned there unless the user scrolled up
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length, inbox]);

  return (
    <div className="rp-body me-tab">
      <div className="filter-bar">
        <ProjectFilter value={pick} onChange={(id) => { setPick(id); setShown(PAGE); stick.current = true; }} />
        <div className="segmented" role="tablist" aria-label="Kind">
          {KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'active' : ''} title={k.title} onClick={() => { setKind(k.id); setShown(PAGE); stick.current = true; }}>
              {k.label}
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} count={searching ? found.length : undefined} placeholder="Search what you asked and the answers" />
      </div>
      <div
        className="me-scroll"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {hidden > 0 && (
          <button className="chat-earlier" onClick={() => { stick.current = false; setShown(shown + PAGE); }}>
            Show earlier ({hidden})
          </button>
        )}
        {list.length === 0 && <div className="muted me-empty">{searching ? 'No matches.' : 'Nothing yet — give an order, or type into a session.'}</div>}
        {list.map((t) => {
          const to = sessions.get(t.item.sessionId);
          const root = projects.find((p) => p.id === rootOf(t.item.sessionId));
          const answers = answersOf(t);
          const st = orderStatus(t, sessions);
          const view = viewOf(t.item);
          const reveal = (): void => {
            if (!selecting() && to) selectAndReveal(to.id);
          };
          return (
            <div key={t.item.id} className="me-turn">
              <div className="me-msg mine" onClick={reveal}>
                <div className="me-meta">
                  <span className="me-kind">{view.kind}</span>
                  <span>→</span>
                  {root && <span className="project-tag" style={pcStyle(projectColor(root.id, projects))}>{root.name}</span>}
                  <span className="ellipsis">{to?.title ?? '(removed session)'}</span>
                  <span className="time" title={formatDateTime(t.item.createdAt)}>{relativeTime(t.item.createdAt, now)}</span>
                </div>
                <MsgText text={view.text} lines={6} />
                {t.children.length > 0 && (
                  <button className="me-more" onClick={(e) => { e.stopPropagation(); openFlow(t.item.id); }} title="Who passed this to whom, as a diagram">
                    Flow ({descendants(t).length + 1} messages) →
                  </button>
                )}
                <CopyButton text={view.text} title="Copy" />
              </div>
              {answers.map((a) => {
                const from = sessions.get(a.sessionId);
                return (
                  <div key={a.id} className="me-msg reply" onClick={() => !selecting() && from && selectAndReveal(from.id)}>
                    <div className="me-meta">
                      <span className="ellipsis">{from?.title ?? '(removed session)'}</span>
                      <span className="time" title={formatDateTime(a.createdAt)}>{relativeTime(a.createdAt, now)}</span>
                    </div>
                    <MsgText text={bodyOf(a)} lines={8} markdown />
                    <CopyButton text={bodyOf(a)} title="Copy" />
                  </div>
                );
              })}
              {answers.length === 0 && WAIT_LABEL[st] && <div className={`me-wait ${st}`}>{WAIT_LABEL[st]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A message body folded to a few lines, with "Show more" when it is longer (the answers are often long reports). */
function MsgText({ text, lines, markdown = false }: { text: string; lines: number; markdown?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  const html = useMemo(() => (markdown ? renderMarkdown(text) : ''), [markdown, text]);
  return (
    <>
      {markdown ? (
        // an answer is often a report in Markdown (bold, lists, tables); folded by height. renderMarkdown escapes all text
        <div
          className={`me-text md chat-md ${long && !open ? 'folded' : ''}`}
          style={long && !open ? { maxHeight: `${lines * 1.55}em` } : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className={`me-text ${long && !open ? 'clamped' : ''}`} style={long && !open ? { WebkitLineClamp: lines } : undefined}>
          {text}
        </div>
      )}
      {long && (
        <button
          className="me-more"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

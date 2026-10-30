import { parseTeamMessages, type TeamMessage } from '@/lib/teamMessage';
import { DelegationStrip } from './Delegations';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatEntry, ChatTool, PermissionScope, Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { send } from '@/client';
import { useChats } from '@/lib/chat';
import { renderMarkdown } from '@/lib/markdown';
import { teamMessageKind } from '@/lib/msgKind';
import { MsgTag } from './MsgTag';
import { openFile } from '@/lib/openfile';
import { lastLines } from '@/lib/ansi';
import { screenLines } from '@/lib/screen';
import { matches, useHighlight } from '@/lib/search';
import { CopyButton } from './SearchBox';
import { imageDataUrl, imageFiles, splitAttachments, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachmentBar } from './AttachmentBar';
import { getBuffer, useBuffer } from '@/lib/buffers';
import { restoreEarlier } from './ContextSize';
import { quickReplyOf, type QuickOption, type QuickReply } from '@/lib/quickReply';
import { kbd } from '@/lib/keys';
import { makeScoper, ScopeCtx, toolScope, useScoper, type Scope } from '@/lib/chatScope';
import { dayTime, displayTitle, formatDateTime, pcStyle, projectColor, relativeTime, roleLabel } from '@/lib/format';
import { useNow } from '@/lib/hooks';

/** Searchable text of a transcript entry: its text, or a tool's name, input and result. */
function entryText(e: ChatEntry): string {
  if (e.tool) return `${e.tool.name} ${JSON.stringify(e.tool.input)} ${e.tool.result ?? ''}`;
  return e.text ?? '';
}

type Source = 'me' | 'team';

/** Each entry's turn: started by the user's own message ('me') or by a team message the daemon typed in ('team'). */
function sources(entries: ChatEntry[]): Map<string, Source> {
  const out = new Map<string, Source>();
  let cur: Source = 'me';
  for (const e of entries) {
    if (e.kind === 'user') cur = e.text && parseTeamMessages(e.text) ? 'team' : 'me';
    out.set(e.id, cur);
  }
  return out;
}


type Segment = { kind: 'entry'; entry: ChatEntry } | { kind: 'team'; key: string; entries: ChatEntry[] };
const CHAT_PAGE_SIZE = 300;

/** Runs of team turns (a team message and the session's work on it) as one segment; the user's own turns stay open. */
function segments(entries: ChatEntry[], src: Map<string, Source>): Segment[] {
  const out: Segment[] = [];
  for (const e of entries) {
    if (src.get(e.id) !== 'team') {
      out.push({ kind: 'entry', entry: e });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'team') last.entries.push(e);
    else out.push({ kind: 'team', key: e.id, entries: [e] });
  }
  return out;
}

/** VS Code-extension-like rendering of a Claude Code transcript, with a composer that types into the PTY. */
export function ChatView({
  session: s,
  onShowTerminal,
  query = '',
  onMatches,
  limit
}: {
  session: Session;
  onShowTerminal: () => void;
  /** show only the latest `limit` entries (Ground cards), with "Show earlier" for the rest */
  limit?: number;
  /** Session tab search: only entries containing it are shown, highlighted */
  query?: string;
  onMatches?: (n: number | undefined) => void;
}): JSX.Element {
  const chat = useChats((st) => st.chats[s.id]);
  const connected = useStore((st) => st.connected);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prependHeight = useRef<number | null>(null);

  useEffect(() => {
    if (connected) send({ type: 'chat.subscribe', id: s.id });
  }, [connected, s.id, s.resumeId]);

  // keep pinned to the bottom unless the user scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.entries]);

  const all = chat?.entries ?? [];
  const searching = query.trim() !== '';
  const [extra, setExtra] = useState(0);
  const src = useMemo(() => sources(all), [all]);
  // the Head Coach's chat labels each message with its project, a Coach's with its part (other chats do not watch the
  // sessions: every status change replaces that map)
  const isHead = s.role === 'head';
  const sessions = useStore((st) => (isHead ? st.sessions : NO_SESSIONS));
  const projects = useStore((st) => (isHead ? st.projects : NO_PROJECTS));
  const scoper = useMemo(() => (isHead ? makeScoper(s, sessions, projects, all) : null), [isHead, s.id, s.projectId, sessions, projects, all]);
  const hasTeam = useMemo(() => [...src.values()].includes('team'), [src]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const found = useMemo(
    () =>
      searching
        ? all.filter((e) => matches(query, entryText(e)))
        : all,
    [all, query, searching]
  );
  const pageSize = limit ?? CHAT_PAGE_SIZE;
  const cap = !searching ? pageSize + extra : Infinity;
  const hidden = Math.max(0, found.length - cap);
  const entries = hidden ? found.slice(hidden) : found;
  useEffect(() => onMatches?.(searching ? found.length : undefined), [found.length, searching, onMatches]);
  useHighlight(scroller, query, [entries]);
  // team runs fold to one row - except the last one (what the session is on now)
  const segs = useMemo(() => (!searching && hasTeam ? segments(entries, src) : null), [entries, src, searching, hasTeam]);
  // each message's clock time (shown when its minute differs from the last shown) and the time of the entry before it
  const marks = useMemo(() => {
    const out = new Map<string, { time?: string; since?: number }>();
    let last = '';
    let prev: ChatEntry | undefined;
    for (const e of entries) {
      const m: { time?: string; since?: number } = {};
      if (prev) m.since = prev.ts;
      const mine = e.kind === 'user' && !(e.text && parseTeamMessages(e.text));
      if (mine || (e.kind === 'assistant' && e.text?.trim())) {
        const c = clockTime(e.ts);
        if (c !== last) {
          m.time = c;
          last = c;
        }
      }
      out.set(e.id, m);
      prev = e;
    }
    return out;
  }, [entries]);
  const working = s.status === 'working' || s.status === 'starting';
  // the answer ends with a question and options: quick-reply buttons instead of typing (not while it works or asks the TUI)
  const quick = useMemo(() => (working ? null : quickReplyOf(all)), [all, working]);
  // A numbered choice (permission / trust prompt) is only visible in the TUI, so sniff the terminal tail.
  // only while waiting: a choice prompt can be on screen (no subscription otherwise)
  const tail = useBuffer(s.id, s.status === 'waiting')?.slice(-6000);
  const choice = useMemo(() => {
    // the daemon reads the screen for a real prompt (trust / permission / confirm): a question Claude asks in its own
    // words ("Do you want me to commit?") is not a choice to pick from
    // paused by the usage limit (the daemon reads it off the screen): shown as that, not as a question
    if (s.limit) return true;
    if (s.attention !== undefined) return s.attention;
    if (!tail) return false;
    const t = lastLines(tail, 14).join('\n');
    return /❯\s*\d+\.|›\s*\d+\.|^\s*\d+\.\s+(Yes|No)\b|Enter to confirm|Press enter to confirm/m.test(t);
  }, [tail, s.attention, s.limit]);

  return (
    <div className="chat" data-cwd={s.cwd} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => { if (!e.ctrlKey) e.stopPropagation(); }}>
      <ScopeCtx.Provider value={scoper}>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {chat && !chat.available && (
          <div className="chat-empty">
            No transcript for this session yet.
            <button className="btn sm" onClick={onShowTerminal}>Show Terminal</button>
          </div>
        )}
        {chat?.available && entries.length === 0 && (
          <div className="chat-empty">{searching ? 'No matches in this conversation.' : 'Send a message to start the conversation.'}</div>
        )}
        {!!s.prevResumeIds?.length && hidden === 0 && entries.length < 40 && !searching && (
          <div className="chat-restarted">
            A new conversation{all[0] ? ` since ${dayTime(all[0].ts)}` : ''} (after a fresh start or restart) — the earlier one is kept.
            <button className="chat-link" onClick={() => restoreEarlier(s)}>Restore earlier conversation</button>
          </div>
        )}
        {hidden > 0 && (
          <button className="chat-earlier" onClick={() => {
            prependHeight.current = scroller.current?.scrollHeight ?? null;
            stick.current = false;
            setExtra(extra + pageSize);
          }}>
            Show earlier ({hidden})
          </button>
        )}
        {segs
          ? segs.map((g, i) =>
              g.kind === 'entry' ? (
                <Fragment key={g.entry.id}>
                  {gapBefore(segs, i) && <TimeDivider ts={g.entry.ts} />}
                  <Entry entry={g.entry} cwd={s.cwd} sid={s.id} {...marks.get(g.entry.id)} />
                </Fragment>
              ) : (
                <Fragment key={g.key}>
                {gapBefore(segs, i) && <TimeDivider ts={g.entries[0]!.ts} />}
                <TeamRun
                  key={g.key}
                  entries={g.entries}
                  cwd={s.cwd}
                  sid={s.id}
                  open={opened.has(g.key)}
                  onToggle={() => {
                    stick.current = false;
                    const next = new Set(opened);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    setOpened(next);
                  }}
                />
                </Fragment>
              )
            )
          : entries.map((e, i) => (
              <Fragment key={e.id}>
                {(i === 0 || e.ts - entries[i - 1]!.ts > DIVIDER_GAP_MS) && <TimeDivider ts={e.ts} />}
                <Entry entry={e} cwd={s.cwd} sid={s.id} {...marks.get(e.id)} />
              </Fragment>
            ))}
        {working && <WorkingLine entries={all} cwd={s.cwd} />}
      </div>
      </ScopeCtx.Provider>
      {/* a small monitor at the top right: the work this coordinator handed out */}
      {s.role !== 'player' && <DelegationStrip id={s.id} />}
      {s.permission ? <PermissionCard session={s} onShowTerminal={onShowTerminal} /> : choice && <WaitingBar session={s} tail={tail ?? ''} onShowTerminal={onShowTerminal} />}
      {/* the old-answer note: in the Session tab / Focus view, not on every Ground card (cards pass a limit) */}
      <Composer session={s} quick={quick} lastAt={working || limit !== undefined ? undefined : lastAnswerAt(all)} />
    </div>
  );
}

/** a pause this long between turns gets a time line, so a reader sees when each part was said */
const DIVIDER_GAP_MS = 20 * 60_000;

const segTs = (g: Segment): number => (g.kind === 'entry' ? g.entry.ts : g.entries[0]!.ts);
const segEnd = (g: Segment): number => (g.kind === 'entry' ? g.entry.ts : g.entries[g.entries.length - 1]!.ts);
function gapBefore(segs: Segment[], i: number): boolean {
  return i === 0 || segTs(segs[i]!) - segEnd(segs[i - 1]!) > DIVIDER_GAP_MS;
}

function TimeDivider({ ts }: { ts: number }): JSX.Element {
  return (
    <div className="chat-time" title={formatDateTime(ts)}>
      <span>{dayTime(ts)}</span>
    </div>
  );
}

/** When the session last answered (its newest assistant text). */
function lastAnswerAt(entries: ChatEntry[]): number | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'assistant' && entries[i]!.text?.trim()) return entries[i]!.ts;
  return undefined;
}

/** an answer this old may no longer match what is going on: the composer offers a short status check */
const STALE_MS = 60 * 60_000;
const STATUS_ASK = 'Status check: in 3–5 short lines — what is done, what is in progress, and what is waiting on me (if anything). Do not start new work.';

/** A run of team turns: the messages fold to "Team - N messages (senders)" (or open with the bar to fold them again); the work on them is never hidden. */
function TeamRun({ entries, cwd, sid, open, onToggle }: { entries: ChatEntry[]; cwd: string; sid: string; open: boolean; onToggle: () => void }): JSX.Element {
  const msgs = entries.flatMap((e) => (e.kind === 'user' && e.text ? (parseTeamMessages(e.text) ?? []) : []));
  const from = [...new Set(msgs.map((m) => m.from))];
  const label = `Team · ${msgs.length} message${msgs.length === 1 ? '' : 's'}`;
  const who = from.slice(0, 3).join(', ') + (from.length > 3 ? ` +${from.length - 3}` : '');
  return (
    <>
      <button className={`chat-teamrun ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open} title={open ? 'Fold the team messages' : 'Show the team messages'}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span>⇄ {label}</span>
        {who && <span className="muted ellipsis">{who}</span>}
      </button>
      {/* the bar folds the team messages only; the session's own work on them (answers, tools) stays in view */}
      {entries.map((e) => (e.kind === 'user' && e.text && parseTeamMessages(e.text) ? open && <Entry key={e.id} entry={e} cwd={cwd} sid={sid} /> : <Entry key={e.id} entry={e} cwd={cwd} sid={sid} />))}
    </>
  );
}

const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** 9s · 1m 12s */
function duration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** "✱ Running Bash… · 1m 12s": what it is doing now (from the newest entry) and how long this turn has run. */
function WorkingLine({ entries, cwd }: { entries: ChatEntry[]; cwd: string }): JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const last = entries[entries.length - 1];
  const turn = [...entries].reverse().find((e) => e.kind === 'user');
  const verb =
    last?.kind === 'tool' && last.tool && !last.tool.done ? `Running ${toolSummary(last.tool, cwd).title}` : last?.kind === 'thinking' ? 'Thinking' : last?.kind === 'assistant' ? 'Writing' : 'Working';
  return (
    <div className="chat-working">
      <span className="spark">✱</span> {verb}…{turn && now > turn.ts ? <span className="muted"> · {duration(now - turn.ts)}</span> : null}
    </div>
  );
}

const Entry = memo(EntryView);

function EntryView({ entry: e, cwd, sid, time, since }: { entry: ChatEntry; cwd: string; sid?: string; time?: string; since?: number }): JSX.Element | null {
  const stamp = time ? <div className="chat-clock">{time}</div> : null;
  if (e.kind === 'user') {
    const team = e.text ? parseTeamMessages(e.text) : null;
    if (team) return <>{team.map((t, i) => <TeamBubble key={i} msg={t} turn={e.id} />)}</>;
    // a long paste is recorded inside <pasted_content> tags: show just the text
    const raw = e.text?.replace(/<\/?pasted_content\b[^>]*>/g, '').trim() ?? '';
    // images attached here are sent as paths: shown as thumbnails instead of the path list ("[Image #1]" is Claude
    // Code's own marker for an image it took in)
    const { body, images } = splitAttachments(raw);
    const text = body.replace(/\[Image #\d+\]/g, '').trim();
    return (
      <>
        {stamp}
        <div className="chat-user">
          <TurnMeta id={e.id} sid={sid} text={text} ts={e.ts} />
          {text && <CopyButton text={text} />}
          {images.length > 0 || e.images ? <ChatImages listed={images} entry={e} sid={sid} cwd={cwd} /> : null}
          {text && <div className="chat-user-text">{text}</div>}
        </div>
      </>
    );
  }
  if (e.kind === 'assistant') return <>{stamp}<Markdown className="chat-item chat-text" text={e.text ?? ''} dot="text" copy /></>;
  if (e.kind === 'thinking') return <Thinking text={e.text ?? ''} took={since !== undefined && e.ts > since && e.ts - since < 3_600_000 ? e.ts - since : undefined} />;
  if (e.kind === 'system') return <div className="chat-system">{e.text}</div>;
  if (e.kind === 'tool' && e.tool) return <Tool tool={e.tool} cwd={cwd} sid={sid} ts={e.ts} />;
  return null;
}

/**
 * Thumbnails of the images sent with a message; a click shows the image in its own window. When the transcript lost
 * the paths (Claude Code took the pasted file in as "[Image #1]"), they come from the inbox record of the same message
 * (the direct note or order the manager sent, kept with its attachment list).
 */
function ChatImages({ listed, entry: e, sid, cwd }: { listed: string[]; entry: ChatEntry; sid?: string; cwd: string }): JSX.Element | null {
  const inbox = useStore((st) => st.inbox);
  const paths = useMemo(() => {
    if (listed.length || !sid) return listed;
    const firstLine = (e.text ?? '').replace(/\[Image #\d+\]/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const near = inbox
      .filter((it) => it.sessionId === sid && it.fromId === 'user' && it.text.includes('[Attached image') && (firstLine.length < 4 || it.text.includes(firstLine)))
      .sort((a, b) => Math.abs(a.createdAt - e.ts) - Math.abs(b.createdAt - e.ts))[0];
    return near ? splitAttachments(near.text).images : [];
  }, [listed, sid, inbox, e.text, e.ts]);
  if (paths.length === 0) return e.images ? <div className="chat-attach">📎 {e.images} image{e.images > 1 ? 's' : ''}</div> : null;
  return (
    <div className="chat-images">
      {paths.map((p) => (
        <ChatImage key={p} path={p} cwd={cwd} />
      ))}
    </div>
  );
}

function ChatImage({ path, cwd }: { path: string; cwd: string }): JSX.Element {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [dim, setDim] = useState('');
  useEffect(() => {
    let live = true;
    void imageDataUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  const name = path.split(/[\/]/).pop() ?? path;
  return (
    <button className={`chat-image ${url === null ? 'missing' : ''}`} title={`${path}
Click to view`} onClick={() => openFile(path, cwd)}>
      {url ? <img src={url} alt="" onLoad={(e) => setDim(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} /> : <span aria-hidden="true">🖼</span>}
      <span className="chat-image-name">{name}</span>
      {dim && <span className="chat-image-dim">{dim}</span>}
      {url === null && <span className="chat-image-dim">not found</span>}
    </button>
  );
}

function Markdown({ text, className, dot, copy }: { text: string; className: string; dot?: 'text'; copy?: boolean }): JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className={className}>
      {dot && <span className="chat-dot text" />}
      {copy && <CopyButton text={text} />}
      {/* renderMarkdown escapes all text; only its own tags are emitted */}
      <div className="md chat-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function Thinking({ text, took }: { text: string; took?: number }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div className="chat-item">
      <span className="chat-dot text" />
      <div className="chat-thinking">
        <button className="chat-link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {took !== undefined && took >= 1000 ? `Thought for ${duration(took)}` : 'Thinking'}</button>
        {open && <div className="chat-thinking-body">{text}</div>}
      </div>
    </div>
  );
}

/* ---------- tools ---------- */

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Show paths inside the session folder relative to it (case-insensitive, either slash). */
function rel(p: string, cwd: string): string {
  const norm = (x: string): string => x.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(p);
  const b = norm(cwd);
  return a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : p;
}

export function toolSummary(t: ChatTool, cwd: string): { title: string; detail: string } {
  const i = t.input;
  switch (t.name) {
    case 'Bash':
    case 'PowerShell':
      return { title: t.name, detail: str(i['description']) || str(i['command']).split('\n')[0]! };
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { title: t.name, detail: rel(str(i['file_path']) || str(i['notebook_path']), cwd) };
    case 'Grep':
      return { title: 'Grep', detail: `${str(i['pattern'])}${i['path'] ? `  in ${rel(str(i['path']), cwd)}` : ''}` };
    case 'Glob':
      return { title: 'Glob', detail: str(i['pattern']) };
    case 'WebFetch':
      return { title: 'Fetch', detail: str(i['url']) };
    case 'WebSearch':
      return { title: 'Search', detail: str(i['query']) };
    case 'Task':
    case 'Agent':
      return { title: 'Agent', detail: str(i['description']) };
    case 'TodoWrite':
      return { title: 'Update Todos', detail: '' };
    default:
      return { title: t.name.replace(/^mcp__[^_]+__/, ''), detail: str(i['description']) };
  }
}

function patchStats(lines: string[]): string {
  const add = lines.filter((l) => l.startsWith('+')).length;
  const del = lines.filter((l) => l.startsWith('-')).length;
  const parts: string[] = [];
  if (add) parts.push(`Added ${add} line${add > 1 ? 's' : ''}`);
  if (del) parts.push(`removed ${del} line${del > 1 ? 's' : ''}`);
  return parts.join(', ');
}

/** The session an AgentO team tool addresses (send_to_session, read_session, …). */
function targetSession(t: ChatTool, sessions: Map<string, Session>): Session | undefined {
  const ref = t.name.startsWith('mcp__agento__') ? t.input['session_id'] : undefined;
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  const r = ref.trim();
  return sessions.get(r) ?? (r.length >= 6 ? [...sessions.values()].find((x) => x.id.startsWith(r)) : undefined);
}

/** A send the daemon queued ("Queued for …") whose target has not become idle since: most likely still undelivered. */
const WAITING_MSG = /^Queued for /;

function Tool({ tool: t, cwd, sid, ts }: { tool: ChatTool; cwd: string; sid?: string; ts?: number }): JSX.Element {
  const { title, detail } = toolSummary(t, cwd);
  const sc = useScoper();
  const scope = sc ? toolScope(t, sc) : null;
  const targetRef = useStore((st) => {
    const to = targetSession(t, st.sessions);
    return to ? `${to.id}\u0001${to.title}\u0001${projectColor(to.projectId, st.projects)}` : null;
  });
  const [targetId, target, targetColor] = targetRef ? targetRef.split('\u0001') : [];
  // the number AgentO gave this send: the inbox record of a directive from this session to that one, nearest in time
  const taskId = useStore((st) => {
    if (t.name !== 'mcp__agento__send_to_session' || !sid || ts === undefined || !targetId) return undefined;
    let best: { id: string; d: number } | undefined;
    for (const it of st.inbox) {
      if (it.kind !== 'directive' || it.fromId !== sid || it.sessionId !== targetId || !it.taskId) continue;
      const d = Math.abs(it.createdAt - ts);
      if (d < 5 * 60_000 && (!best || d < best.d)) best = { id: it.taskId, d };
    }
    return best?.id;
  });
  const undelivered = useStore((st) => {
    if (t.name !== 'mcp__agento__send_to_session' || !WAITING_MSG.test(t.result ?? '')) return false;
    const to = targetSession(t, st.sessions);
    return !!to && to.status !== 'waiting';
  });
  const state = !t.done ? 'run' : t.isError ? 'err' : 'ok';
  let body: JSX.Element | null = null;

  if (t.patch && t.patch.length && !t.isError) {
    body = (
      <>
        <div className="chat-sub">{patchStats(t.patch)}</div>
        <Diff lines={t.patch} />
      </>
    );
  } else if (t.name === 'TodoWrite' && Array.isArray(t.input['todos'])) {
    body = (
      <ul className="chat-todos">
        {(t.input['todos'] as { content?: string; status?: string }[]).map((td, i) => (
          <li key={i} className={td.status}>
            <span>{td.status === 'completed' ? '☑' : td.status === 'in_progress' ? '◐' : '☐'}</span> {td.content}
          </li>
        ))}
      </ul>
    );
  } else if (t.name === 'mcp__agento__send_to_session' && typeof t.input['message'] === 'string' && !t.isError) {
    body = <SentMessage text={t.input['message']} quiet={t.input['directive'] === false} result={t.result} to={target ?? ''} />;
  } else if (t.name === 'Bash' || t.name === 'PowerShell') {
    body = <InOut input={str(t.input['command'])} output={t.result} error={t.isError} />;
  } else if (t.name === 'Read' || t.name === 'Glob' || t.name === 'Grep') {
    body = t.isError && t.result ? <InOut output={t.result} error /> : null;
  } else if (t.result !== undefined || Object.keys(t.input).length) {
    const input = Object.entries(t.input)
      .filter(([k]) => k !== 'description')
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');
    body = <InOut input={input || undefined} output={t.result} error={t.isError} />;
  }

  return (
    <div className="chat-item">
      <span className={`chat-dot ${state}`} />
      <div className="chat-tool">
        <div className="chat-tool-head">
          <b>{title}</b>
          {target && (
            <button className="chat-target" style={targetColor ? pcStyle(targetColor) : undefined} onClick={() => targetId && selectAndReveal(targetId)} title={`Open ${target}`}>
              <span className="seg">→ {scope ? `${scope.name} › ${target}` : target}</span>
            </button>
          )}
          {taskId && <span className="task-id chat-task" title="The piece of work AgentO numbered when this was sent">{taskId}</span>}
          {undelivered && <span className="chat-undelivered" title="Queued: the session is busy or stopped, so it gets this when it is idle">⏳ waiting</span>}
          {scope && !target && <ScopeTag scope={scope} />}
          {detail && <span className="chat-tool-detail" title={detail}>{detail}</span>}
        </div>
        {body}
      </div>
    </div>
  );
}

/** Text folded to `lines` visible lines (a long line that wraps counts too); "Show more" only when something is hidden. */
function Collapsible({ text, lines = 2, className }: { text: string; lines?: number; className?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const body = text.replace(/\s+$/, '');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = (): void => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [body, open, lines]);
  return (
    <div className={className}>
      <pre ref={ref} className="chat-clip" style={open ? undefined : { maxHeight: `${lines * 1.45}em`, overflow: 'hidden' }}>{body}</pre>
      {(clipped || open) && (
        <button className="chat-link" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** What one session told another: the message itself, in the foreground, with how it went below it. */
function SentMessage({ text, quiet, result, to }: { text: string; quiet: boolean; result?: string; to: string }): JSX.Element {
  const queued = WAITING_MSG.test(result ?? '');
  return (
    <div className="chat-sent">
      <Collapsible className="chat-sent-text" text={text} lines={4} />
      <div className="chat-sent-foot">
        {result === undefined ? 'Sending…' : queued ? `Queued — ${to || 'it'} gets this when idle` : `Delivered${to ? ` to ${to}` : ''}`}
        {quiet && ' · no completion report asked'}
      </div>
    </div>
  );
}

function InOut({ input, output, error }: { input?: string; output?: string; error?: boolean }): JSX.Element {
  return (
    <div className="chat-io">
      {input !== undefined && (
        <div className="row">
          <span className="lbl">IN</span>
          <Collapsible className="val" text={input} lines={2} />
        </div>
      )}
      {output !== undefined && output.trim() !== '' && (
        <div className={`row ${error ? 'err' : ''}`}>
          <span className="lbl">{error ? 'ERR' : 'OUT'}</span>
          <Collapsible className="val out" text={output} lines={2} />
        </div>
      )}
    </div>
  );
}

function Diff({ lines }: { lines: string[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const LIMIT = 24;
  const shown = open ? lines : lines.slice(0, LIMIT);
  return (
    <div className="chat-diff">
      {shown.map((l, i) =>
        l === '@@' ? (
          <div key={i} className="gap">⋯</div>
        ) : (
          <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx'}>
            {l.slice(1) || ' '}
          </div>
        )
      )}
      {lines.length > LIMIT && (
        <button className="chat-link" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show ${lines.length - LIMIT} more lines`}
        </button>
      )}
    </div>
  );
}

/* ---------- input ---------- */

/**
 * The numbered choice on the terminal (a permission or trust prompt): its question, a few lines of context (the tool
 * and command it asks about) and the options. Read from the last lines; null when they cannot be made out.
 */
/** One option of a terminal choice: shown as n, picked by typing `keys` (its number, or arrows + Enter). */
interface ChoiceOption {
  n: string;
  label: string;
  current: boolean;
  keys: string;
}

/**
 * A list without numbers ("❯ No, exit" / "  Yes, I trust this folder" above "Enter to confirm"): the marked line is
 * the current one; another is picked with Up / Down and Enter.
 */
function readArrowChoice(screen: string[]): { question: string; context: string[]; options: ChoiceOption[] } | null {
  const raw = screen.map((l) => l.replace(/\s+$/, ''));
  let k = -1;
  for (let i = raw.length - 1; i >= 0; i--) if (/enter to (confirm|select)|esc to cancel/i.test(raw[i]!)) {
    k = i;
    break;
  }
  if (k < 0) return null;
  let i = k - 1;
  while (i >= 0 && !raw[i]!.trim()) i--;
  let block: string[] = [];
  for (; i >= 0 && raw[i]!.trim() && block.length < 12; i--) block.unshift(raw[i]!);
  // the options are what comes after the question line (when one is in the block), and each is a short line
  const q = block.map((l) => /\?\s*$/.test(l.trim())).lastIndexOf(true);
  if (q >= 0) {
    i += q + 1;
    block = block.slice(q + 1);
  }
  if (block.some((l) => l.trim().length > 90) || block.length > 8) return null;
  const marked = block.findIndex((l) => /^\s*[❯>›]\s+\S/.test(l));
  if (marked < 0 || block.length < 2) return null;
  const options: ChoiceOption[] = block.map((l, idx) => {
    const d = idx - marked;
    return {
      n: String(idx + 1),
      label: l.replace(/^\s*[❯>›]?\s*/, '').trim(),
      current: idx === marked,
      keys: (d > 0 ? '\x1b[B'.repeat(d) : '\x1b[A'.repeat(-d)) + '\r'
    };
  });
  // the question: the nearest line above that asks (or names the prompt), within a dozen lines
  const above = raw
    .slice(Math.max(0, i - 12), i + 1)
    .map((l) => l.replace(/^[\s│┃|╭╮╰╯─━]+|[\s│┃|╭╮╰╯─━]+$/g, '').trim())
    .filter(Boolean);
  let qi = -1;
  for (let j = above.length - 1; j >= 0; j--) if (/\?\s*$|trust|permission|proceed/i.test(above[j]!)) {
    qi = j;
    break;
  }
  const question = qi >= 0 ? above[qi]! : above[above.length - 1] ?? '';
  return { question, context: (qi >= 0 ? above.slice(qi + 1) : []).slice(-3), options };
}

type Choice = { question: string; context: string[]; options: ChoiceOption[]; limit?: boolean };

function readChoice(screen: string[]): Choice | null {
  return readSetupDialog(screen) ?? readNumberedChoice(screen) ?? readArrowChoice(screen);
}

/** Claude Code waiting for the usage limit to reset: nothing to answer — shown as that, with a way to stop waiting. */
function limitChoice(reset: string): Choice {
  return {
    limit: true,
    question: `Claude's usage limit is reached — it resets ${reset}. The session continues by itself when it does; there is nothing to answer.`,
    context: [],
    options: [{ n: '1', label: 'Stop waiting (Esc) — it will not continue by itself', current: false, keys: '\x1b' }]
  };
}

/**
 * A CLI's own setup dialog (Claude Code's "Teach auto mode about your environment?", toggles changed with ←/→): not a
 * choice of the work — offered as Skip (Esc) or Continue (Enter) instead of its lines read as options.
 */
function readSetupDialog(screen: string[]): { question: string; context: string[]; options: ChoiceOption[] } | null {
  const text = screen.join('\n');
  const auto = /Teach\s*auto\s*mode/i.test(text);
  if (!auto && !/←\s*\/\s*→\s*change/i.test(text)) return null;
  const q = screen.map((l) => l.trim()).filter((l) => /\?\s*$/.test(l)).pop() ?? 'A setup dialog of the CLI';
  return {
    question: auto ? 'Claude Code offers to set up auto mode (optional) — it would scan this project and your recent sessions.' : q,
    context: [],
    options: [
      { n: '1', label: 'Skip (recommended)', current: true, keys: '\x1b' },
      { n: '2', label: 'Continue with its settings', current: false, keys: '\r' }
    ]
  };
}

function readNumberedChoice(screen: string[]): { question: string; context: string[]; options: ChoiceOption[] } | null {
  const lines = screen.map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).slice(-30);
  const opt = /^[\s│┃|]*([❯>›])?\s*(\d)[.)]\s+(.+?)[\s│┃|]*$/;
  // the last run of numbered lines (1, 2, 3 …)
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (opt.test(lines[i]!)) {
    end = i;
    break;
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0 && opt.test(lines[start - 1]!)) start--;
  const options = lines.slice(start, end + 1).map((l) => {
    const m = opt.exec(l)!;
    return { n: m[2]!, label: m[3]!.trim(), current: !!m[1], keys: m[2]! };
  });
  if (options[0]?.n !== '1') return null;
  // the question: the last line above the options that asks (ends with "?"); context: what it asks about — the lines
  // between the question and the options (tool, command, file), else the lines just above (box borders dropped)
  const above = lines
    .slice(Math.max(0, start - 8), start)
    .map((l) => l.replace(/^[\s│┃|╭╮╰╯─━]+|[\s│┃|╭╮╰╯─━]+$/g, '').trim())
    .filter(Boolean);
  let qi = -1;
  for (let i = above.length - 1; i >= 0; i--) if (/\?\s*$/.test(above[i]!)) {
    qi = i;
    break;
  }
  if (qi < 0) {
    const question = above.pop() ?? '';
    return { question, context: above.slice(-3), options };
  }
  const after = above.slice(qi + 1);
  return { question: above[qi]!, context: (after.length ? after : above.slice(Math.max(0, qi - 3), qi)).slice(-5), options };
}

function WaitingBar({ session: s, tail, onShowTerminal }: { session: Session; tail: string; onShowTerminal: () => void }): JSX.Element {
  const key = (data: string): void => send({ type: 'session.input', id: s.id, data });
  // the terminal as it looks now (replayed off-screen at the session's size), read for the question and its options
  const [choice, setChoice] = useState<ReturnType<typeof readChoice>>(null);
  useEffect(() => {
    let live = true;
    const raw = getBuffer(s.id) ?? tail;
    const t = setTimeout(() => {
      void screenLines(raw.slice(-200_000), s.cols || 100, s.rows || 30).then((lines) => {
        if (!live) return;
        // the replayed screen first; when it cannot be read (or is empty), the plain-text tail — words spaced by the shared converter
        const found = s.limit ? limitChoice(s.limit) : (lines.length ? readChoice(lines) : null) ?? readChoice(lastLines(tail, 30));
        if (!found) console.warn('[chat] choice prompt not read; screen tail:', lines.slice(-12), 'plain tail:', lastLines(tail, 12));
        setChoice(found);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tail, s.id, s.cols, s.rows]);
  // a permission (run / edit / trust) or a question Claude asks with choices (AskUserQuestion)
  const permission = !choice || /do you want|proceed|allow|permission|trust|would you like to run|make this edit|apply/i.test(`${choice.question} ${choice.context.join(' ')}`);
  /** an option that hands the turn back to the user ("No, and tell Claude what to do differently") */
  const tellsClaude = (label: string): boolean => /tell (claude|codex)|what to do differently|type something|other/i.test(label);
  const pick = (keys: string, label: string): void => {
    key(keys);
    // after "tell Claude what to do", the next message is the instruction: put the cursor in the message box
    if (tellsClaude(label)) setTimeout(() => document.querySelector<HTMLTextAreaElement>(`.chat-composer[data-session="${s.id}"] textarea`)?.focus(), 150);
  };
  return (
    <div className={`chat-choice-card ${choice?.limit ? 'limit' : permission ? 'permission' : 'question'}`}>
      <div className="chat-choice-head">
        <span className="chat-choice-kind">{choice?.limit ? '⏳ Usage limit' : permission ? '🔒 Permission' : '? Question'}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onShowTerminal}>Terminal</button>
      </div>
      <div className="chat-choice-q">{choice?.question || `${s.agent === 'claude' ? 'Claude' : 'The session'} is waiting for your choice`}</div>
      {choice && choice.context.length > 0 && <pre className="chat-choice-ctx">{choice.context.join('\n')}</pre>}
      <div className="chat-choice-list">
        {choice ? (
          choice.options.map((o) => (
            <button key={o.n} className={`chat-choice-opt ${o.current ? 'current' : ''}`} onClick={() => pick(o.keys, o.label)} title={o.label}>
              <span className="n">{o.n}</span>
              <span className="label">{o.label}</span>
            </button>
          ))
        ) : (
          <div className="chat-choice-raw">
            {['1', '2', '3'].map((n) => (
              <button key={n} className="btn sm" onClick={() => key(n)}>{n}</button>
            ))}
            <button className="btn sm" onClick={() => key('\r')}>Enter</button>
            <span className="muted">The options could not be read — open the terminal to see them.</span>
          </div>
        )}
      </div>
      <div className="chat-choice-foot">
        <button className="btn sm ghost" onClick={() => key('\x1b')} title="Cancel (Esc)">Esc · cancel</button>
      </div>
    </div>
  );
}

/** What a tool call asks to do, in one line: the command, the file, the pattern … */
function permissionGist(input: Record<string, unknown>): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
  const one = s(input['command'] ?? input['file_path'] ?? input['path'] ?? input['pattern'] ?? input['url'] ?? input['query'] ?? input['description'] ?? '');
  return one.trim();
}

/**
 * Headless Claude asks whether it may use a tool (Bash, Edit, WebFetch …): the question arrives as an event, not a
 * screen — Allow / Deny answer it. The session waits until the manager decides.
 */
function PermissionCard({ session: s, onShowTerminal }: { session: Session; onShowTerminal: () => void }): JSX.Element | null {
  const p = s.permission;
  if (!p) return null;
  const answer = (allow: boolean, scope: PermissionScope = 'once'): void => send({ type: 'session.permission', id: s.id, requestId: p.id, allow, scope });
  const gist = permissionGist(p.input);
  const rest = Object.entries(p.input).filter(([k, v]) => v !== undefined && !['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description'].includes(k) || (typeof v === 'string' ? v : JSON.stringify(v)) !== gist);
  return (
    <div className="chat-choice-card permission">
      <div className="chat-choice-head">
        <span className="chat-choice-kind">🔒 Permission · {p.tool}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onShowTerminal}>Log</button>
      </div>
      <div className="chat-choice-q">{s.agent === 'claude' ? 'Claude' : 'The session'} wants to use <b>{p.tool}</b>{gist ? ':' : '.'}</div>
      {gist && <pre className="chat-choice-ctx">{gist}</pre>}
      {rest.length > 0 && gist === '' && <pre className="chat-choice-ctx">{JSON.stringify(p.input, null, 1).slice(0, 1200)}</pre>}
      <div className="chat-choice-list perm">
        <button className="chat-choice-opt" onClick={() => answer(true)} title="Allow this call">
          <span className="n">✓</span>
          <span className="label">Allow</span>
        </button>
        <button className="chat-choice-opt" onClick={() => answer(true, 'tool')} title={`Allow ${p.tool} now and every later ${p.tool} call of this session without asking`}>
          <span className="n">✓</span>
          <span className="label">Always allow {p.tool} in this session</span>
        </button>
        <button className="chat-choice-opt" onClick={() => answer(true, 'session')} title="Allow this and every later tool call of this session without asking">
          <span className="n">✓✓</span>
          <span className="label">Allow everything in this session</span>
        </button>
        {s.folderId && (
          <button className="chat-choice-opt" onClick={() => answer(true, 'folder')} title="Mark this session's folder as trusted: every session there works without asking">
            <span className="n">★</span>
            <span className="label">Trust this folder (all its sessions)</span>
          </button>
        )}
        <button className="chat-choice-opt" onClick={() => answer(false)} title="Deny this call (Claude is told the manager did not allow it)">
          <span className="n">✗</span>
          <span className="label">Deny</span>
        </button>
      </div>
      <div className="chat-choice-foot muted">Folders marked trusted (auto-trust) are not asked.</div>
    </div>
  );
}

/** Replay pace: one character per tick, faster for long messages so typing stays within REPLAY_MAX_MS. */
const REPLAY_TICK_MS = 30;
const REPLAY_MAX_MS = 8000;
/** pause after the last character, then the Send press stays lit this long */
const REPLAY_PAUSE_MS = 400;
const REPLAY_SEND_MS = 700;

/** The message box under a session's conversation — also used for terminal agents (Codex) in the Session tab. */
export function Composer({ session: s, quick, lastAt }: { session: Session; quick?: QuickReply | null; lastAt?: number }): JSX.Element {
  const nowTick = useNow(60_000);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [quickClosed, setQuickClosed] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  // a team message typed into this session by the daemon, replayed here: typed out, then "sent"
  const [ghost, setGhost] = useState<{ text: string; sending: boolean } | null>(null);
  const delivered = useStore((st) => st.delivered[s.id]);
  const textRef = useRef(text);
  textRef.current = text;
  // deliveries replay one after another; the runner types the head of the queue, then takes the next
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seen = useRef(delivered?.nonce ?? 0); // a delivery from before this card was mounted is not replayed
  useEffect(() => {
    if (!delivered || delivered.nonce === seen.current) return;
    seen.current = delivered.nonce;
    queue.current.push(delivered.text);
    if (playing.current) return;
    const next = (): void => {
      const full = queue.current.shift();
      if (full === undefined || textRef.current) {
        // done, or the user started a draft: never type over it
        queue.current = [];
        playing.current = false;
        setGhost(null);
        return;
      }
      playing.current = true;
      const step = Math.max(1, Math.ceil(full.length / (REPLAY_MAX_MS / REPLAY_TICK_MS)));
      let n = 0;
      const type = (): void => {
        n = Math.min(full.length, n + step);
        setGhost({ text: full.slice(0, n), sending: false });
        if (n < full.length) timer.current = setTimeout(type, REPLAY_TICK_MS);
        else
          timer.current = setTimeout(() => {
            setGhost({ text: full, sending: true });
            timer.current = setTimeout(next, REPLAY_SEND_MS);
          }, REPLAY_PAUSE_MS);
      };
      type();
    };
    next();
  }, [delivered]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const live = s.status === 'working' || s.status === 'waiting' || s.status === 'starting';

  const files = useAttachments();
  // a stopped session (hibernated, done, error) can be written to: it is started and gets the message when ready
  const wakeable = !live && (s.status === 'hibernated' || s.status === 'done' || s.status === 'error');
  // shown as running but without a process (stale state): go through the daemon, which starts it first
  const running = live && s.pid !== undefined;
  const submit = (override?: string): void => {
    const t = (override ?? text).trim();
    if (!t || files.busy || (!live && !wakeable)) return;
    const body = withAttachments(t, files.items);
    // kept in the log (Me tab), with the answer reported back
    send({ type: 'session.note', id: s.id, text: body });
    // running: typed in now by the daemon (one paste, Enter, and Enter again if it did not take); stopped: woken first
    if (running) send({ type: 'session.paste', id: s.id, text: body });
    else send({ type: 'session.message', id: s.id, text: body });
    setText('');
    setPicked([]);
    files.clear();
  };
  // quick replies: one id per offered set, so "Other" (closing it) holds until the session asks again
  const quickId = quick ? [...quick.options.map((o) => o.key + o.label), ...(quick.questions ?? [])].join('|') : '';
  // yes/no questions: one picked = sent as is; several = each one answered (checked = yes)
  const words = quick?.ko ? { yes: '네', no: '아니요', goAhead: '네, 그렇게 해 주세요.', dont: '아니요, 하지 말아 주세요.' } : { yes: 'Yes', no: 'No', goAhead: 'Yes, go ahead.', dont: 'No, don’t.' };
  const { yes, no } = words;
  const answerAll = (qs: string[], ok: (i: number) => boolean): string =>
    qs.length === 1 ? (ok(0) ? words.goAhead : words.dont) : qs.map((q, i) => `${i + 1}. ${q} → ${ok(i) ? yes : no}`).join('\n');
  const showQuick = !!quick && !text && !ghost && quickClosed !== quickId && (live || wakeable);
  const pickOne = (o: QuickOption): void => submit(o.send ?? `${o.key}. ${o.label}`);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
    if (ghost) el.scrollTop = el.scrollHeight;
  }, [text, ghost]);

  // the last answer is old: say when it was, and offer a status check before acting on it
  const stale = lastAt !== undefined && nowTick - lastAt > STALE_MS && !text && !ghost && (live || wakeable);
  return (
    <>
    {stale && (
      <div className="chat-stale">
        <span>
          Last answer <b>{relativeTime(lastAt!, nowTick)}</b> ({dayTime(lastAt!, nowTick)}) — things may have moved on since.
        </span>
        <button className="btn sm ghost" onClick={() => submit(STATUS_ASK)} title={`Sends: "${STATUS_ASK}"`}>
          Ask for status
        </button>
      </div>
    )}
    {showQuick && quick && (
      <div className={`quick-reply ${quick.questions ? 'yesno' : ''}`} role="group" aria-label="Quick reply">
        {quick.questions && quick.questions.length === 1 && (
          <>
            <span className="quick-reply-title">Answer</span>
            <label className="quick-opt" title={`Send "${answerAll(quick.questions, () => true)}"`}>
              <input type="radio" name={`quick-${s.id}`} onChange={() => submit(answerAll(quick.questions!, () => true))} />
              <b>{yes}</b>
            </label>
            <label className="quick-opt" title={`Send "${answerAll(quick.questions, () => false)}"`}>
              <input type="radio" name={`quick-${s.id}`} onChange={() => submit(answerAll(quick.questions!, () => false))} />
              <b>{no}</b>
            </label>
          </>
        )}
        {quick.questions && quick.questions.length > 1 && (
          <>
            <span className="quick-reply-title">Check = {yes}</span>
            {quick.questions.map((q, i) => (
              <label key={q} className={`quick-opt quick-q ${picked.includes(String(i)) ? 'on' : ''}`} title={q}>
                <input
                  type="checkbox"
                  checked={picked.includes(String(i))}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, String(i)] : picked.filter((k) => k !== String(i)))}
                />
                <span className="ellipsis">{q}</span>
              </label>
            ))}
            <button className="btn sm primary" onClick={() => submit(answerAll(quick.questions!, (i) => picked.includes(String(i))))}>
              Send
            </button>
          </>
        )}
        {!quick.questions && <span className="quick-reply-title">{quick.multi ? 'Pick any' : 'Pick one'}</span>}
        {quick.options.map((o) =>
          quick.multi ? (
            <label key={o.key} className={`quick-opt ${picked.includes(o.key) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={picked.includes(o.key)}
                onChange={(e) => setPicked(e.target.checked ? [...picked, o.key] : picked.filter((k) => k !== o.key))}
              />
              <b>{o.key}</b> <span className="ellipsis">{o.label}</span>
            </label>
          ) : (
            <label key={o.key} className="quick-opt" title={`Send "${o.send ?? `${o.key}. ${o.label}`}"`}>
              <input type="radio" name={`quick-${s.id}`} onChange={() => pickOne(o)} />
              {!o.send && <b>{o.key}</b>} <span className="ellipsis">{o.label}</span>
            </label>
          )
        )}
        {quick.multi && !quick.questions && (
          <button
            className="btn sm primary"
            disabled={!picked.length}
            onClick={() => submit(quick.options.filter((o) => picked.includes(o.key)).map((o) => `${o.key}. ${o.label}`).join('\n'))}
          >
            Send
          </button>
        )}
        <button
          className="btn sm ghost"
          title="Type your own answer"
          onClick={() => {
            setQuickClosed(quickId);
            setTimeout(() => ref.current?.focus(), 0);
          }}
        >
          Other…
        </button>
      </div>
    )}
    {files.items.length > 0 && (
      <div className="chat-attachments">
        <AttachmentBar items={files.items} onRemove={files.remove} />
      </div>
    )}
    <div className={`chat-composer ${ghost ? 'replay' : ''}`} data-session={s.id}>
      <textarea
        ref={ref}
        rows={1}
        value={ghost ? (ghost.sending ? ghost.text : `${ghost.text}▍`) : text}
        readOnly={ghost !== null}
        disabled={!live && !wakeable && !ghost}
        placeholder={live ? kbd('Message… (Ctrl+Enter to send)') : wakeable ? kbd('Message… (starts the session, Ctrl+Enter to send)') : 'Not running'}
        title="Enter to send · Shift+Enter for a new line · paste or drop images"
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
          // Ctrl+Enter sends (as in Orders and Tasks); Enter is a new line
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape' && s.status === 'working') {
            send({ type: 'session.input', id: s.id, data: '\x1b' });
          }
        }}
      />
      <button className={`btn primary sm ${ghost?.sending ? 'sending' : ''}`} disabled={!ghost && ((!live && !wakeable) || !text.trim() || files.busy)} onClick={() => submit()}>Send</button>
    </div>
    </>
  );
}

const NO_SESSIONS = new Map<string, Session>();
const NO_PROJECTS: Project[] = [];

/** How a sender shows on a team bubble: chip class, name, role, chip color — one string (cheap to compare). */
function senderView(x: Session | undefined, projects: Project[]): string {
  if (!x) return '';
  const cls = x.role === 'head' ? (x.projectId ? 'project' : 'manager') : x.role;
  return [cls, displayTitle(x), roleLabel(x), cls === 'project' ? projectColor(x.projectId, projects) : ''].join('\u0001');
}

/** A message from the team (another session, the manager's order, an AgentO notice) — sender chip + body. */
function TeamBubble({ msg, turn }: { msg: TeamMessage; turn: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const sc = useScoper();
  // the sender as it is named now ("Head Coach · Shop" (head coach) → Shop · Coach), when the session still exists —
  // selected as one string, so a status change of the sender does not re-render the bubble
  // (a notice such as "X finished" is from AgentO, but it is about a session: that session is shown as its origin)
  const refId = msg.sessionId ?? msg.aboutId;
  const view = useStore((st) => {
    const id = refId;
    const sender = id ? st.sessions.get(id) ?? (id.length < 36 ? [...st.sessions.values()].find((x) => x.id.startsWith(id)) : undefined) : undefined;
    return senderView(sender, st.projects);
  });
  const [senderClass, senderName, senderRole, senderColor] = view ? view.split('\u0001') : [];
  const senderId = useStore((st) => {
    const id = refId;
    return id ? (st.sessions.get(id) ?? (id.length < 36 ? [...st.sessions.values()].find((x) => x.id.startsWith(id)) : undefined))?.id : undefined;
  });
  // a session's message: its own project/part; a notice: the session it is about; an order: what the turn touched
  const own = refId && sc ? sc.ofSession(refId) : null;
  const scopes = own ? [own] : msg.kind === 'session' ? [] : sc?.turns.get(turn) ?? [];
  const long = msg.body.length > 600;
  const roleClass = senderClass ?? (msg.kind === 'order' ? 'manager' : msg.kind === 'notice' ? 'notice' : msg.role?.includes('head') ? 'head' : msg.role?.includes('coach') ? 'coach' : 'player');
  const from = senderName ?? msg.from;
  const role = msg.kind === 'notice' ? undefined : senderRole ?? msg.role;
  const origin = { ...(senderId ? { onClick: () => selectAndReveal(senderId), title: `Open ${from}` } : {}) };
  return (
    <div className={`chat-team ${msg.kind} ${['task', 'order'].includes(teamMessageKind(msg)) ? 'instruction' : ''}`}>
      <div className="chat-team-head">
        {own && senderName ? (
          // one label for where it came from: project/part › session
          <button className="chat-target" style={pcStyle(own.color)} {...origin}>
            <span className="seg">{own.name} › {from}</span>
          </button>
        ) : (
          <span className={`team-chip ${roleClass} ${senderId ? 'link' : ''}`} style={senderColor ? pcStyle(senderColor) : undefined} {...origin}>
            {from}
          </span>
        )}
        <MsgTag kind={teamMessageKind(msg)} {...(msg.taskId ? { taskId: msg.taskId } : {})} />
        {role && role !== from && <span className="muted">{role}</span>}
        {msg.via && <span className="muted">{msg.via}</span>}
        {scopes.filter((x) => !(own && senderName && x.name === own.name)).map((x) => <ScopeTag key={x.name} scope={x} />)}
        <span className="grow" />
        <CopyButton text={msg.body} />
      </div>
      <Markdown className={`chat-team-body ${long && !open ? 'clamped' : ''}`} text={msg.body || '(empty)'} />
      {long && (
        <button className="chat-team-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>
      )}
    </div>
  );
}

/** Project (Head Coach) or part (Coach) a message is about. */
function ScopeTag({ scope }: { scope: Scope }): JSX.Element {
  return <span className="scope-tag" style={pcStyle(scope.color)} title={scope.name}>{scope.name}</span>;
}

/**
 * Above the user's own turn: the number AgentO gave it (the inbox record of that direct input — same session, the text
 * in it, nearest in time) at the left, and the projects/parts it went to (in a Head Coach or Coach chat) at the right.
 */
function TurnMeta({ id, sid, text, ts }: { id: string; sid?: string; text: string; ts: number }): JSX.Element | null {
  const list = useScoper()?.turns.get(id);
  const taskId = useStore((st) => {
    if (!sid) return undefined;
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    let best: { id: string; d: number } | undefined;
    for (const it of st.inbox) {
      if (it.kind !== 'directive' || it.fromId !== 'user' || it.sessionId !== sid || !it.taskId) continue;
      if (first.length >= 4 && !it.text.includes(first.slice(0, 80))) continue;
      const d = Math.abs(it.createdAt - ts);
      if (d < 10 * 60_000 && (!best || d < best.d)) best = { id: it.taskId, d };
    }
    return best?.id;
  });
  if (!taskId && !list?.length) return null;
  return (
    <div className="chat-user-scopes">
      {taskId && <span className="task-id chat-task chat-user-task" title="The piece of work AgentO numbered when this was sent">{taskId}</span>}
      {list?.map((x) => <ScopeTag key={x.name} scope={x} />)}
    </div>
  );
}

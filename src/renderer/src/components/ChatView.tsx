import { parseTeamMessages, type TeamMessage } from '@/lib/teamMessage';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatEntry, ChatTool, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { useChats } from '@/lib/chat';
import { renderMarkdown } from '@/lib/markdown';
import { lastLines } from '@/lib/ansi';
import { screenLines } from '@/lib/screen';
import { matches, useHighlight } from '@/lib/search';
import { CopyButton } from './SearchBox';
import { imageFiles, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachButton, AttachmentBar } from './AttachmentBar';
import { getBuffer, useBuffer } from '@/lib/buffers';
import { restoreEarlier } from './ContextSize';
import { kbd } from '@/lib/keys';

/** Searchable text of a transcript entry: its text, or a tool's name, input and result. */
function entryText(e: ChatEntry): string {
  if (e.tool) return `${e.tool.name} ${JSON.stringify(e.tool.input)} ${e.tool.result ?? ''}`;
  return e.text ?? '';
}

type Source = 'me' | 'team';
type ChatFilter = 'all' | Source;

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

const filterKey = (id: string): string => `asm.chatFilter.${id}`;
function loadFilter(id: string): ChatFilter {
  try {
    const v = localStorage.getItem(filterKey(id));
    if (v === 'me' || v === 'team') return v;
  } catch {
    /* default */
  }
  return 'all';
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
  // All · Me · Team: the user's own turns vs the team traffic the daemon typed in (per session)
  const [filter, setFilterState] = useState<ChatFilter>(() => loadFilter(s.id));
  useEffect(() => setFilterState(loadFilter(s.id)), [s.id]);
  const setFilter = (f: ChatFilter): void => {
    setFilterState(f);
    stick.current = true;
    try {
      localStorage.setItem(filterKey(s.id), f);
    } catch {
      /* not kept */
    }
  };
  const src = useMemo(() => sources(all), [all]);
  const hasTeam = useMemo(() => [...src.values()].includes('team'), [src]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const found = useMemo(
    () =>
      searching
        ? all.filter((e) => matches(query, entryText(e)))
        : filter === 'all' || !hasTeam
          ? all
          : all.filter((e) => src.get(e.id) === filter),
    [all, query, searching, filter, src, hasTeam]
  );
  const pageSize = limit ?? CHAT_PAGE_SIZE;
  const cap = !searching ? pageSize + extra : Infinity;
  const hidden = Math.max(0, found.length - cap);
  const entries = hidden ? found.slice(hidden) : found;
  useEffect(() => onMatches?.(searching ? found.length : undefined), [found.length, searching, onMatches]);
  useHighlight(scroller, query, [entries]);
  // in All, team runs fold to one row - except the last one (what the session is on now)
  const segs = useMemo(() => (filter === 'all' && !searching && hasTeam ? segments(entries, src) : null), [entries, src, filter, searching, hasTeam]);
  const working = s.status === 'working' || s.status === 'starting';
  // A numbered choice (permission / trust prompt) is only visible in the TUI, so sniff the terminal tail.
  // only while waiting: a choice prompt can be on screen (no subscription otherwise)
  const tail = useBuffer(s.id, s.status === 'waiting')?.slice(-6000);
  const choice = useMemo(() => {
    // the daemon reads the screen for a real prompt (trust / permission / confirm): a question Claude asks in its own
    // words ("Do you want me to commit?") is not a choice to pick from
    if (s.attention !== undefined) return s.attention;
    if (!tail) return false;
    const t = lastLines(tail, 14).join('\n');
    return /❯\s*\d+\.|›\s*\d+\.|^\s*\d+\.\s+(Yes|No)\b|Enter to confirm|Press enter to confirm/m.test(t);
  }, [tail, s.attention]);

  return (
    <div className="chat" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => { if (!e.ctrlKey) e.stopPropagation(); }}>
      {hasTeam && !searching && (
        <div className="chat-filter" role="tablist" aria-label="Show messages">
          {(['all', 'me', 'team'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'active' : ''}
              title={f === 'all' ? 'Everything (team traffic folded)' : f === 'me' ? 'Only what you typed, with the answers' : 'Only the team traffic: orders, reports, notices'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'me' ? 'Me' : 'Team'}
            </button>
          ))}
        </div>
      )}
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
            A new conversation (after a fresh start or restart) — the earlier one is kept.
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
        {chat?.available && filter === 'me' && hasTeam && !searching && entries.length === 0 && (
          <div className="chat-empty">Nothing typed by you in this conversation yet.</div>
        )}
        {segs
          ? segs.map((g, i) =>
              g.kind === 'entry' ? (
                <Entry key={g.entry.id} entry={g.entry} cwd={s.cwd} />
              ) : (
                <TeamRun
                  key={g.key}
                  entries={g.entries}
                  cwd={s.cwd}
                  open={i === segs.length - 1 || opened.has(g.key)}
                  onToggle={() => {
                    stick.current = false;
                    const next = new Set(opened);
                    if (next.has(g.key)) next.delete(g.key);
                    else next.add(g.key);
                    setOpened(next);
                  }}
                />
              )
            )
          : entries.map((e) => <Entry key={e.id} entry={e} cwd={s.cwd} />)}
        {working && (
          <div className="chat-working">
            <span className="spark">✱</span> Working…
          </div>
        )}
      </div>
      {choice && <WaitingBar session={s} tail={tail ?? ''} onShowTerminal={onShowTerminal} />}
      <Composer session={s} />
    </div>
  );
}

/** A run of team turns: folded to "Team - N messages (senders)", or open with a header to fold it again. */
function TeamRun({ entries, cwd, open, onToggle }: { entries: ChatEntry[]; cwd: string; open: boolean; onToggle: () => void }): JSX.Element {
  const msgs = entries.flatMap((e) => (e.kind === 'user' && e.text ? (parseTeamMessages(e.text) ?? []) : []));
  const from = [...new Set(msgs.map((m) => m.from))];
  const label = `Team · ${msgs.length} message${msgs.length === 1 ? '' : 's'}`;
  const who = from.slice(0, 3).join(', ') + (from.length > 3 ? ` +${from.length - 3}` : '');
  return (
    <>
      <button className={`chat-teamrun ${open ? 'open' : ''}`} onClick={onToggle} aria-expanded={open} title={open ? 'Fold the team traffic' : 'Show the team traffic'}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span>⇄ {label}</span>
        {who && <span className="muted ellipsis">{who}</span>}
      </button>
      {open && entries.map((e) => <Entry key={e.id} entry={e} cwd={cwd} />)}
    </>
  );
}

function Entry({ entry: e, cwd }: { entry: ChatEntry; cwd: string }): JSX.Element | null {
  if (e.kind === 'user') {
    const team = e.text ? parseTeamMessages(e.text) : null;
    if (team) return <>{team.map((t, i) => <TeamBubble key={i} msg={t} />)}</>;
    // a long paste is recorded inside <pasted_content> tags: show just the text
    const text = e.text?.replace(/<\/?pasted_content\b[^>]*>/g, '').trim();
    return (
      <div className="chat-user">
        {text && <CopyButton text={text} />}
        {e.images ? <div className="chat-attach">📎 {e.images} image{e.images > 1 ? 's' : ''}</div> : null}
        {text && <div className="chat-user-text">{text}</div>}
      </div>
    );
  }
  if (e.kind === 'assistant') return <Markdown className="chat-item chat-text" text={e.text ?? ''} dot="text" copy />;
  if (e.kind === 'thinking') return <Thinking text={e.text ?? ''} />;
  if (e.kind === 'system') return <div className="chat-system">{e.text}</div>;
  if (e.kind === 'tool' && e.tool) return <Tool tool={e.tool} cwd={cwd} />;
  return null;
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

function Thinking({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-item">
      <span className="chat-dot text" />
      <div className="chat-thinking">
        <button className="chat-link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Thinking</button>
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

function Tool({ tool: t, cwd }: { tool: ChatTool; cwd: string }): JSX.Element {
  const { title, detail } = toolSummary(t, cwd);
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
          {detail && <span className="chat-tool-detail" title={detail}>{detail}</span>}
        </div>
        {body}
      </div>
    </div>
  );
}

function Collapsible({ text, lines = 4, className }: { text: string; lines?: number; className?: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const all = text.replace(/\s+$/, '').split('\n');
  const long = all.length > lines;
  return (
    <div className={className}>
      <pre>{open || !long ? all.join('\n') : all.slice(0, lines).join('\n')}</pre>
      {long && (
        <button className="chat-link" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show ${all.length - lines} more lines`}
        </button>
      )}
    </div>
  );
}

function InOut({ input, output, error }: { input?: string; output?: string; error?: boolean }): JSX.Element {
  return (
    <div className="chat-io">
      {input !== undefined && (
        <div className="row">
          <span className="lbl">IN</span>
          <Collapsible className="val" text={input} lines={6} />
        </div>
      )}
      {output !== undefined && output.trim() !== '' && (
        <div className={`row ${error ? 'err' : ''}`}>
          <span className="lbl">{error ? 'ERR' : 'OUT'}</span>
          <Collapsible className="val out" text={output} lines={4} />
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
  const block: string[] = [];
  for (; i >= 0 && raw[i]!.trim() && block.length < 12; i--) block.unshift(raw[i]!);
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

function readChoice(screen: string[]): { question: string; context: string[]; options: ChoiceOption[] } | null {
  const numbered = readNumberedChoice(screen);
  return numbered ?? readArrowChoice(screen);
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
        const found = (lines.length ? readChoice(lines) : null) ?? readChoice(lastLines(tail, 30));
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
    <div className={`chat-choice-card ${permission ? 'permission' : 'question'}`}>
      <div className="chat-choice-head">
        <span className="chat-choice-kind">{permission ? '🔒 Permission' : '? Question'}</span>
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

/** Replay pace: one character per tick, faster for long messages so typing stays within REPLAY_MAX_MS. */
const REPLAY_TICK_MS = 30;
const REPLAY_MAX_MS = 8000;
/** pause after the last character, then the Send press stays lit this long */
const REPLAY_PAUSE_MS = 400;
const REPLAY_SEND_MS = 700;

/** The message box under a session's conversation — also used for terminal agents (Codex) in the Session tab. */
export function Composer({ session: s }: { session: Session }): JSX.Element {
  const [text, setText] = useState('');
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
  const submit = (): void => {
    const t = text.trim();
    if (!t || files.busy || (!live && !wakeable)) return;
    const body = withAttachments(t, files.items);
    // kept in the log (Me tab), with the answer reported back
    send({ type: 'session.note', id: s.id, text: body });
    // running: typed in now by the daemon (one paste, Enter, and Enter again if it did not take); stopped: woken first
    if (running) send({ type: 'session.paste', id: s.id, text: body });
    else send({ type: 'session.message', id: s.id, text: body });
    setText('');
    files.clear();
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
    if (ghost) el.scrollTop = el.scrollHeight;
  }, [text, ghost]);

  return (
    <>
    {files.items.length > 0 && (
      <div className="chat-attachments">
        <AttachmentBar items={files.items} onRemove={files.remove} />
      </div>
    )}
    <div className={`chat-composer ${ghost ? 'replay' : ''}`} data-session={s.id}>
      <AttachButton onFiles={files.add} disabled={!live && !wakeable} />
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
      <button className={`btn primary sm ${ghost?.sending ? 'sending' : ''}`} disabled={!ghost && ((!live && !wakeable) || !text.trim() || files.busy)} onClick={submit}>Send</button>
    </div>
    </>
  );
}

/** A message from the team (another session, the manager's order, an AgentO notice) — sender chip + body. */
function TeamBubble({ msg }: { msg: TeamMessage }): JSX.Element {
  const [open, setOpen] = useState(false);
  const long = msg.body.length > 600;
  const roleClass = msg.kind === 'order' ? 'manager' : msg.kind === 'notice' ? 'notice' : msg.role?.includes('head') ? 'head' : msg.role?.includes('coach') ? 'coach' : 'player';
  return (
    <div className={`chat-team ${msg.kind}`}>
      <div className="chat-team-head">
        <span className={`team-chip ${roleClass}`}>{msg.from}</span>
        {msg.role && <span className="muted">{msg.role}</span>}
        {msg.via && <span className="muted">{msg.via}</span>}
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

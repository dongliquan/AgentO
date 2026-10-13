import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { exportSession, focusTerminal, removeSession, selectAndReveal } from '@/commands';
import { AGENT_LABELS, agentColor, basename, formatElapsed, displayTitle } from '@/lib/format';
import { RoleTag } from './RoleTag';
import { lastLines } from '@/lib/ansi';
import { startDrag, throttle } from '@/lib/drag';
import { useNow } from '@/lib/hooks';
import { StatusBadge } from './StatusBadge';
import { ContextSize, freshStart, restoreEarlier } from './ContextSize';
import { TerminalView } from './TerminalView';
import { ChatView } from './ChatView';
import { AgentIcon } from './AgentIcon';
import { useBuffer } from '@/lib/buffers';

export type CardLayout = 'board' | 'static' | 'fill';

interface Props {
  session: Session;
  layout: CardLayout;
  /** board zoom, used for LOD; ignored for other layouts */
  zoom?: number;
  selected?: boolean;
}

const MIN_W = 240;
const MIN_H = 160;

function SessionCardImpl({ session, layout, zoom = 1, selected }: Props): JSX.Element {
  const s = session;
  const patchLocal = useStore((st) => st.patchSessionLocal);
  const select = useStore((st) => st.select);
  const setFocusMode = useStore((st) => st.setFocusMode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.title);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Claude sessions open in the formatted chat view; the raw TUI stays one click away.
  // Claude, and Codex once its conversation is found, read as a chat; other CLIs are terminals
  const hasChat = s.agent === 'claude' || (s.agent === 'codex' && !!s.resumeId);
  const [view, setView] = useState<'chat' | 'terminal'>(hasChat ? 'chat' : 'terminal');
  const viewRef = useRef(view);
  viewRef.current = view;
  // "Terminal" (Session tab, a choice card, a menu): a card showing its chat switches to the terminal first — the
  // focus request only reaches a mounted terminal — then asks again once the terminal is there
  useEffect(() => {
    const onFocus = (e: Event): void => {
      if ((e as CustomEvent<{ sessionId: string }>).detail?.sessionId !== s.id || viewRef.current === 'terminal') return;
      setView('terminal');
      setTimeout(() => window.dispatchEvent(new CustomEvent('asm:focus-terminal', { detail: { sessionId: s.id } })), 120);
    };
    window.addEventListener('asm:focus-terminal', onFocus);
    return () => window.removeEventListener('asm:focus-terminal', onFocus);
  }, [s.id]);
  const dragging = useRef(false);

  const persist = useMemo(
    () =>
      throttle((patch: { x?: number; y?: number; w?: number; h?: number }) => {
        send({ type: 'session.update', id: s.id, patch });
      }, 300),
    [s.id]
  );

  // F2 / menu rename
  useEffect(() => {
    const onRename = (e: Event): void => {
      const d = (e as CustomEvent<{ sessionId: string }>).detail;
      if (d?.sessionId === s.id) {
        setDraft(s.title);
        setEditing(true);
      }
    };
    window.addEventListener('asm:rename', onRename);
    return () => window.removeEventListener('asm:rename', onRename);
  }, [s.id, s.title]);

  const commitTitle = (): void => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== s.title) {
      patchLocal(s.id, { title: t });
      send({ type: 'session.update', id: s.id, patch: { title: t } });
    }
  };

  const onHeaderDown = (e: React.PointerEvent): void => {
    if (layout !== 'board' || editing) return;
    if ((e.target as HTMLElement).closest('button,input')) return;
    const ox = s.x;
    const oy = s.y;
    startDrag(e, {
      scale: () => useStore.getState().zoom,
      onStart: () => {
        dragging.current = true;
      },
      onMove: (dx, dy) => {
        const nx = Math.round(ox + dx);
        const ny = Math.round(oy + dy);
        patchLocal(s.id, { x: nx, y: ny });
        persist({ x: nx, y: ny });
      },
      onEnd: () => {
        dragging.current = false;
        persist.flush();
      }
    });
  };

  const onResizeDown = (e: React.PointerEvent): void => {
    e.stopPropagation();
    const ow = s.w;
    const oh = s.h;
    startDrag(e, {
      scale: () => useStore.getState().zoom,
      threshold: 0,
      onMove: (dx, dy) => {
        const nw = Math.max(MIN_W, Math.round(ow + dx));
        const nh = Math.max(MIN_H, Math.round(oh + dy));
        patchLocal(s.id, { w: nw, h: nh });
        persist({ w: nw, h: nh });
      },
      onEnd: () => persist.flush()
    });
  };

  const showTerminal = layout !== 'board' || zoom >= 0.6;
  // status and role show in the header only (badge, tag); the card border stays plain
  const cls = ['card', layout === 'board' ? '' : layout, selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ');
  const style: React.CSSProperties = layout === 'board' ? { left: s.x, top: s.y, width: s.w, height: s.h, zIndex: selected ? 10 : 1 } : {};

  const answer = (): void => {
    selectAndReveal(s.id);
    const st = useStore.getState();
    if (st.viewMode === 'board' && st.zoom < 0.6 && !st.focusMode) st.setZoom(1);
    setTimeout(() => focusTerminal(s.id), 120);
  };

  return (
    <div
      className={cls}
      data-session-card={s.id}
      style={style}
      data-session-id={s.id}
      onPointerDownCapture={() => {
        if (!selected) select(s.id);
      }}
    >
      <div className="card-header" onPointerDown={onHeaderDown} onDoubleClick={() => { setDraft(s.title); setEditing(true); }}>
        <AgentIcon kind={s.agent} color={s.color} size={16} />
        <RoleTag s={s} />
        {editing ? (
          <input
            className="title-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setEditing(false);
                e.stopPropagation();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="title ellipsis" title={s.title}>{displayTitle(s)}</span>
        )}
        <span className="folder ellipsis" title={s.cwd}>{basename(s.cwd)}</span>
        {hasChat && (
          <div className="segmented sm" onPointerDown={(e) => e.stopPropagation()}>
            <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>Chat</button>
            <button className={view === 'terminal' ? 'active' : ''} onClick={() => setView('terminal')}>Terminal</button>
          </div>
        )}
        <ContextSize session={s} />
        <StatusBadge status={s.status} attention={s.attention} compact={s.w < 300} />
        <button
          className="card-menu-btn"
          title="Menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.right - 170, y: r.bottom + 4 });
          }}
        >
          ⋯
        </button>
      </div>
      <div className="card-body">
        {!showTerminal ? (
          <Preview sessionId={s.id} />
        ) : view === 'chat' ? (
          <ChatView session={s} onShowTerminal={() => setView('terminal')} limit={40} />
        ) : (
          <>
            {!(s.status === 'working' || s.status === 'waiting' || s.status === 'starting') && (
              // the terminal still shows the last screen of the stopped process: keys would go nowhere
              <div className="term-stopped">
                <span>Not running — this is its last screen.</span>
                <button className="btn sm primary" onClick={() => send({ type: 'session.resume', id: s.id })}>
                  Start
                </button>
              </div>
            )}
            <TerminalView sessionId={s.id} fitKey={`${s.w}x${s.h}:${layout}`} autoFocus={layout === 'fill'} />
          </>
        )}
      </div>
      <Footer session={s} onAnswer={answer} onFocusMode={() => { select(s.id); setFocusMode(true); }} />
      {layout === 'board' && <div className="resize-handle" onPointerDown={onResizeDown} />}
      {menu && <CardMenu session={s} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Preview({ sessionId }: { sessionId: string }): JSX.Element {
  const buf = useBuffer(sessionId);
  const lines = useMemo(() => lastLines(buf ?? '', 6), [buf]);
  if (lines.length === 0) return <div className="card-preview empty">No output</div>;
  return <div className="card-preview">{lines.join('\n')}</div>;
}

function Footer({ session: s, onAnswer, onFocusMode }: { session: Session; onAnswer: () => void; onFocusMode: () => void }): JSX.Element {
  const now = useNow(1000);
  const live = s.status === 'working' || s.status === 'waiting' || s.status === 'starting';
  return (
    <div className="card-footer">
      <span style={{ color: agentColor(s.agent, s.color) }}>{AGENT_LABELS[s.agent]}</span>
      <span>·</span>
      <span title="Elapsed time">{formatElapsed(s.createdAt, now)}</span>
      <span className="spacer" />
      {s.status === 'waiting' && (
        <button className="btn primary sm" onClick={onAnswer}>Reply</button>
      )}
      {live && (
        <button className="btn sm" onClick={() => send({ type: 'session.stop', id: s.id })} title="Send Ctrl+C">Stop</button>
      )}
      {(s.status === 'done' || s.status === 'error') && (
        <button className="btn sm" onClick={() => send({ type: 'session.restart', id: s.id })}>Restart</button>
      )}
      {s.status === 'hibernated' && (
        <button className="btn sm" onClick={() => send({ type: 'session.resume', id: s.id })}>Resume</button>
      )}
      <button className="btn sm ghost" onClick={onFocusMode} title="F11">Focus</button>
    </div>
  );
}

function CardMenu({ session: s, x, y, onClose }: { session: Session; x: number; y: number; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const item = (label: string, fn: () => void, cls = ''): JSX.Element => (
    <button
      className={`item ${cls}`}
      onClick={() => {
        fn();
        onClose();
      }}
    >
      {label}
    </button>
  );
  const live = s.status === 'working' || s.status === 'waiting' || s.status === 'starting';
  const projectHasCoach = useStore((st) => [...st.sessions.values()].some((o) => o.role === 'coach' && o.projectId === s.projectId));
  return (
    <div className="popover" ref={ref} style={{ left: Math.max(4, x), top: y }} onPointerDown={(e) => e.stopPropagation()}>
      {item('Rename (F2)', () => window.dispatchEvent(new CustomEvent('asm:rename', { detail: { sessionId: s.id } })))}
      <div className="sep" />
      {live && item('Stop (Ctrl+C)', () => send({ type: 'session.stop', id: s.id }))}
      {live && item('Hibernate', () => send({ type: 'session.hibernate', id: s.id }))}
      {s.status === 'hibernated' && item('Resume', () => send({ type: 'session.resume', id: s.id }))}
      {item('Restart', () => send({ type: 'session.restart', id: s.id }))}
      {s.agent === 'claude' && s.resumeId && item('Fresh Start (handoff note → new conversation)', () => freshStart(s))}
      {s.agent === 'claude' && !!s.prevResumeIds?.length && item('Restore Earlier Conversation', () => restoreEarlier(s))}
      {live && item('Force Kill', () => send({ type: 'session.kill', id: s.id }), 'danger')}
      <div className="sep" />
      {s.role === 'player' && item('Duplicate', () => send({ type: 'session.create', projectId: s.projectId, folderId: s.folderId, agent: s.agent, title: `${s.title} (copy)`, cols: 100, rows: 30 }))}
      {item('Open Folder', () => void window.desktop.openPath(s.cwd))}
      {item('Open in VS Code', () => void window.desktop.openInVsCode(s.cwd))}
      {item('External Terminal', () => void window.desktop.openExternalTerminal(s.cwd))}
      {item('Export Log', () => exportSession(s.id))}
      {s.role === 'player' && !projectHasCoach && item('Make Coach', () => send({ type: 'session.setRole', id: s.id, role: 'coach' }))}
      {s.role === 'coach' && s.folderId && item('Back to Player', () => send({ type: 'session.setRole', id: s.id, role: 'player' }))}
      <div className="sep" />
      {item('Remove Session', () => {
        removeSession(s.id);
      })}
    </div>
  );
}

/** Re-renders only when its own props change — not on every pan / zoom frame of the Ground. */
export const SessionCard = memo(SessionCardImpl);

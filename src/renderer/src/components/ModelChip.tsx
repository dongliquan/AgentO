import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '@shared/protocol';
import { send } from '@/client';
import { askText } from '@/lib/prompt';
import { useEscape } from '@/lib/hooks';

/** Claude models to pick from (the CLI takes the full ids with --model and /model). */
const CLAUDE_MODELS: { id: string; label: string; note: string }[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1', note: 'strongest, most usage' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'strong coding' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'fast, much less usage' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'lightest' }
];

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5"; other ids as they are. */
export function modelLabel(id: string | undefined): string {
  if (!id) return '';
  // "claude-opus-5" (no minor version) too
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' 1M' : ''}`;
}

/**
 * The session's model: what its conversation last ran on, and the manager's pick (shown "→ Sonnet 5.5" until a turn
 * runs on it). Click: pick another — a running Claude waiting for input switches now, otherwise at its next start.
 */
export function ModelChip({ session: s }: { session: Session }): JSX.Element | null {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEscape(!!menu, () => setMenu(null));
  if (s.agent !== 'claude' && s.agent !== 'codex') return null;
  const now = modelLabel(s.model);
  const pick = modelLabel(s.modelPref);
  const pending = !!s.modelPref && s.modelPref !== s.model;
  const text = pending ? `${now ? `${now} ` : ''}→ ${pick}` : now || pick || 'Model';
  const set = (model: string): void => {
    send({ type: 'session.setModel', id: s.id, model });
    setMenu(null);
  };
  return (
    <>
      <button
        className={`model-chip ${pending ? 'pending' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: Math.min(r.left, window.innerWidth - 248), y: r.bottom + 230 > window.innerHeight ? Math.max(8, r.top - 230) : r.bottom + 4 });
        }}
        title={`Model: ${s.model ?? 'not known yet'}${s.modelPref ? `\nPicked: ${s.modelPref}${pending ? ' (applies from the next turn / start)' : ''}` : ''}\nClick to change`}
      >
        {text}
      </button>
      {menu &&
        createPortal(
        <>
          <div className="fileref-scrim" onMouseDown={() => setMenu(null)} />
          <div className="popover model-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="fileref-path muted">{s.agent === 'claude' ? 'Claude model' : 'Codex model'} — {s.status === 'waiting' && s.agent === 'claude' ? 'switches now' : 'from the next start'}</div>
            {s.agent === 'claude' &&
              CLAUDE_MODELS.map((m) => (
                <button key={m.id} className={`item ${(s.modelPref ?? s.model) === m.id ? 'on' : ''}`} onClick={() => set(m.id)}>
                  <span>{m.label}</span>
                  <span className="muted model-note">{m.note}</span>
                </button>
              ))}
            {s.agent === 'codex' && (
              <button
                className="item"
                onClick={() => {
                  setMenu(null);
                  void askText('Codex model', { placeholder: s.model ?? 'e.g. gpt-6-luna' }).then((v) => v?.trim() && set(v.trim()));
                }}
              >
                Enter a model…
              </button>
            )}
            <button className={`item ${!s.modelPref ? 'on' : ''}`} onClick={() => set('')}>
              <span>Default</span>
              <span className="muted model-note">{s.agent !== 'claude' ? 'the CLI’s default' : s.role === 'player' ? 'Opus 5.5' : 'the coordinator default (Sonnet)'}</span>
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

import type { Session } from '@shared/protocol';
import { send } from '@/client';

/** sizes that matter: past AUTO the daemon starts the session over by itself once it has been idle a while */
export const CONTEXT_WARN = 150_000;
export const CONTEXT_AUTO = 200_000;
/** head coaches / coaches: cleared sooner (every report re-reads their conversation) */
export const CONTEXT_AUTO_COORD = 100_000;

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}

/**
 * How big a Claude conversation is now — every turn re-reads all of it. Grey while small, amber from 150K, red from
 * 200K (an idle session that big, not in use, gets a fresh start automatically). Click: fresh start now.
 */
export function ContextSize({ session: s }: { session: Session }): JSX.Element | null {
  if ((s.agent !== 'claude' && s.agent !== 'codex') || !s.context) return null;
  const auto = s.role === 'player' ? CONTEXT_AUTO : CONTEXT_AUTO_COORD;
  const level = s.context >= auto ? 'big' : s.context >= Math.min(CONTEXT_WARN, auto * 0.75) ? 'warn' : '';
  return (
    <button
      className={`context-size ${level}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (s.agent === 'claude') freshStart(s);
      }}
      title={
        `Conversation size: ${formatTokens(s.context)} tokens — re-read on every turn.\n` +
        `Click for a fresh start: it writes a handoff note, then continues in a new, small conversation.` +
        (s.context >= auto ? `\nOver ${formatTokens(auto)}: done automatically after 25 minutes idle, unless you have it selected or typed into it in the last 2 hours.` : '')
      }
    >
      {formatTokens(s.context)}
    </button>
  );
}

/** Back to the conversation before the last fresh start / restart (the current one is kept and can be restored again). */
export function restoreEarlier(s: Session): void {
  if (!window.confirm(`Go back to the earlier conversation of "${s.title}"?

The one before the last fresh start or restart is resumed (with its full context — large conversations cost more tokens per turn). The current conversation is kept and can be restored the same way.`)) return;
  send({ type: 'session.restorePrev', id: s.id });
}

export function freshStart(s: Session): void {
  const size = s.context ? ` (${formatTokens(s.context)} tokens now)` : '';
  if (!window.confirm(`Fresh start "${s.title}"${size}?\n\nIt writes a handoff note, then starts over as a new conversation that reads the note first — same card, much smaller context.`)) return;
  send({ type: 'session.fresh', id: s.id });
}

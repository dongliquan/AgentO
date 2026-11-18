import type { Session } from '@shared/protocol';
import { presence, type PresenceKind } from '@/lib/presence';
import { useNeedsIds } from './NeedsYou';

/** The dot alone (idle and off show none). */
export function PresenceDot({ kind, title }: { kind: PresenceKind; title?: string }): JSX.Element {
  return <span className={`pdot p-${kind}`} title={title} />;
}

/** A session's state: its dot and one word (compact: the dot only, the word on hover). */
export function PresenceBadge({ session: s, compact }: { session: Session; compact?: boolean }): JSX.Element {
  const asked = useNeedsIds((n) => n.ids.has(s.id));
  const p = presence(s, asked);
  return (
    <span className={`presence p-${p.kind}`} title={p.label}>
      <PresenceDot kind={p.kind} />
      {!compact && <span>{p.label}</span>}
    </span>
  );
}

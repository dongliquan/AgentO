import type { SessionStatus } from '@shared/protocol';
import { STATUS_ICONS, statusClass, statusLabel } from '@/lib/format';

export function StatusBadge({ status, attention, compact, waitingOn = 0 }: { status: SessionStatus; attention?: boolean; compact?: boolean; waitingOn?: number }): JSX.Element {
  // a coordinator whose turn is over but whose players are still on what it handed out: waiting, not idle
  const handedOut = waitingOn > 0 && status === 'waiting' && !attention;
  const cls = handedOut ? 'handed' : statusClass({ status, attention });
  const label = handedOut ? `Waiting on ${waitingOn}` : statusLabel({ status, attention });
  return (
    <span className={`status-badge ${cls}`} title={label}>
      {status === 'done' || status === 'hibernated' ? <span>{STATUS_ICONS[status]}</span> : <span className={`status-dot ${cls}`} />}
      {!compact && <span>{label}</span>}
    </span>
  );
}

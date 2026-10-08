import type { SessionStatus } from '@shared/protocol';
import { STATUS_ICONS, statusClass, statusLabel } from '@/lib/format';

export function StatusBadge({ status, attention, compact }: { status: SessionStatus; attention?: boolean; compact?: boolean }): JSX.Element {
  const cls = statusClass({ status, attention });
  const label = statusLabel({ status, attention });
  return (
    <span className={`status-badge ${cls}`} title={label}>
      {status === 'done' || status === 'hibernated' ? <span>{STATUS_ICONS[status]}</span> : <span className={`status-dot ${cls}`} />}
      {!compact && <span>{label}</span>}
    </span>
  );
}

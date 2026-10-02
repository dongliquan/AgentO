import type { SessionStatus } from '@shared/protocol';
import { STATUS_ICONS, STATUS_LABELS } from '@/lib/format';

export function StatusBadge({ status, compact }: { status: SessionStatus; compact?: boolean }): JSX.Element {
  return (
    <span className={`status-badge ${status}`} title={STATUS_LABELS[status]}>
      {status === 'done' || status === 'hibernated' ? <span>{STATUS_ICONS[status]}</span> : <span className={`status-dot ${status}`} />}
      {!compact && <span>{STATUS_LABELS[status]}</span>}
    </span>
  );
}

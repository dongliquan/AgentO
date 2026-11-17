import { useStore } from '@/store';
import { useTeamMode } from '@/lib/teamMode';

/**
 * Today and the Timeline are one screen with two views: "Now" (what needs you, who is working, what is next) and
 * "History" (the features each project finished, by day). Only in team mode — without it there is only Now.
 */
export function PageSwitch(): JSX.Element | null {
  const team = useTeamMode((t) => t.team);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  if (!team) return null;
  return (
    <div className="segmented sm page-switch" role="tablist" aria-label="Today view">
      <button role="tab" aria-selected={viewMode === 'today'} className={viewMode === 'today' ? 'active' : ''} onClick={() => setViewMode('today')}>
        Now
      </button>
      <button role="tab" aria-selected={viewMode === 'timeline'} className={viewMode === 'timeline' ? 'active' : ''} onClick={() => setViewMode('timeline')} title="The features each project finished, by day (Ctrl+4)">
        History
      </button>
    </div>
  );
}

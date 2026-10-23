import { useDraft } from '@/lib/draft';

/** how far back the Inbox and the Logs look by default (older records stay, they are only hidden) */
export const RECENT_MS = 7 * 86_400_000;

/** The Inbox's and the Logs' shared "last 7 days / all" choice. */
export function useRecentOnly(): [boolean, (v: boolean) => void] {
  return useDraft<boolean>('feed.recentOnly', true);
}

export function RecentToggle({ value, onChange, hidden }: { value: boolean; onChange: (v: boolean) => void; hidden: number }): JSX.Element {
  return (
    <div className="segmented sm recent-toggle" role="tablist" aria-label="Period">
      <button className={value ? 'active' : ''} onClick={() => onChange(true)} title="Only the last 7 days (older records are kept, just hidden)">7 days</button>
      <button className={!value ? 'active' : ''} onClick={() => onChange(false)} title={hidden ? `Everything, ${hidden} older included` : 'Everything'}>
        All{value && hidden ? ` +${hidden}` : ''}
      </button>
    </div>
  );
}

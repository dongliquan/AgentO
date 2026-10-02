import { useEffect } from 'react';
import { useStore } from '@/store';
import { SessionCard } from './SessionCard';

/** F11: one session fills the center area. */
export function FocusView(): JSX.Element {
  const selectedId = useStore((s) => s.selectedId);
  const session = useStore((s) => (s.selectedId ? s.sessions.get(s.selectedId) : undefined));
  const setFocusMode = useStore((s) => s.setFocusMode);

  useEffect(() => {
    if (!session) setFocusMode(false);
  }, [session, setFocusMode]);

  if (!session) return <div className="tab-main" />;
  return (
    <div className="tab-main focus-view">
      {/* a bar of its own: floating over the card it covered the card header (status badge) */}
      <div className="focus-bar">
        <span className="muted">Focus</span>
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => setFocusMode(false)} title="Esc / F11">Exit Focus Mode</button>
      </div>
      <div className="focus-card">
        <SessionCard key={selectedId ?? ''} session={session} layout="fill" selected />
      </div>
    </div>
  );
}

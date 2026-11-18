import { useEffect, useMemo } from 'react';
import { useStore } from '@/store';
import { startAwayWatch, useAway } from '@/lib/away';
import { dayTime, pcStyle, projectColor, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useNeedsIds } from './NeedsYou';

/** Mounted once (main window): watches for a pause, and after one found at app start opens Today with the summary. */
export function AwayWatcher(): null {
  const atStart = useAway((s) => s.atStart && s.since !== null);
  useEffect(() => startAwayWatch(), []);
  useEffect(() => {
    if (!atStart) return;
    const st = useStore.getState();
    if (st.viewMode === 'board') st.setViewMode('today');
    useAway.setState({ atStart: false });
  }, [atStart]);
  return null;
}

/**
 * Today's top card after a pause: what happened while the manager was away — what waits for an answer and what each
 * Autopilot did. Built from what AgentO already has (no tokens).
 */
export function AwayCard(): JSX.Element | null {
  const since = useAway((s) => s.since);
  const projects = useStore((s) => s.projects);
  const needs = useNeedsIds((s) => s.list);
  const now = useNow(60_000);

  const autopilots = useMemo(
    () => (since === null ? [] : projects.filter((p) => p.autopilot && (p.autopilot.on || (p.autopilot.lastAt ?? 0) >= since))),
    [since, projects]
  );
  if (since === null) return null;
  return (
    <section className="away-card" aria-label="While you were away">
      <div className="away-head">
        <b>While you were away</b>
        <span className="muted">since {dayTime(since)} · {relativeTime(since, now)}</span>
        <span className="away-sum">
          <b className={needs.length ? 'warn' : ''}>{needs.length}</b> need you
        </span>
        <span className="grow" />
        <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => useAway.getState().dismiss()}>
          ×
        </button>
      </div>
      <div className="away-body">
        {autopilots.length > 0 && (
          <div className="away-block">
            <h4>Autopilot</h4>
            {autopilots.map((p) => (
              <div key={p.id} className="away-line" style={pcStyle(projectColor(p.id, projects))}>
                <span className="today-proj">{p.name}</span>
                <span>{p.autopilot!.on ? `running · continued ${p.autopilot!.continues}×` : `off — ${p.autopilot!.note ?? ''}`}</span>
                {p.autopilot!.lastAt ? <span className="muted">{relativeTime(p.autopilot!.lastAt, now)}</span> : null}
              </div>
            ))}
          </div>
        )}
        {autopilots.length === 0 && <div className="muted today-empty">{needs.length ? 'See "Needs you" below.' : 'Nothing needed you while you were away.'}</div>}
      </div>
    </section>
  );
}

import { useEffect, useMemo } from 'react';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { useOpenInbox, useOpenThreads } from '@/lib/closed';
import { startAwayWatch, useAway } from '@/lib/away';
import { buildTimeline, featureName, isFeature } from '@/lib/timeline';
import { isAck } from '@/lib/threads';
import { inboxViewOf } from '@/lib/inboxText';
import { useGitSubjects } from '@/lib/gitSubjects';
import { dayTime, displayTitle, pcStyle, projectColor, relativeTime, rootProject } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useNeedsIds } from './NeedsYou';
import { useFlow } from './OrderFlow';

const MAX_REPORTS = 8;

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
 * Today's top card after a pause: what happened while the manager was away — what waits for an answer, the features
 * finished, the reports that came in, and what each Autopilot did. Built from what AgentO already has (no tokens).
 */
export function AwayCard(): JSX.Element | null {
  const since = useAway((s) => s.since);
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const inbox = useOpenInbox();
  const threads = useOpenThreads();
  const subjects = useGitSubjects((s) => s.subjects);
  const needs = useNeedsIds((s) => s.list);
  const openFlow = useFlow((s) => s.open);
  const now = useNow(60_000);

  const data = useMemo(() => {
    if (since === null) return null;
    const tl = buildTimeline(threads, sessions, projects, since);
    const features = tl
      .map((p) => ({ ...p, rows: p.rows.filter((r) => r.kind === 'feature' && r.ts >= since && isFeature(r)) }))
      .filter((p) => p.rows.length > 0);
    // reports from a session to the manager since the pause (a hand-off note is not one)
    const reports = inbox
      .filter((it) => it.kind === 'report' && it.fromId === it.sessionId && it.createdAt >= since && !isAck(it))
      .sort((a, b) => b.createdAt - a.createdAt);
    const autopilots = projects.filter((p) => !p.parentId && p.autopilot && (p.autopilot.on || (p.autopilot.lastAt ?? 0) >= since));
    return { features, reports, autopilots };
  }, [since, threads, sessions, projects, inbox]);

  if (since === null || !data) return null;
  const featureCount = data.features.reduce((n, p) => n + p.rows.length, 0);
  const projectOf = (sessionId: string): { name: string; color: string } | undefined => {
    const s = sessions.get(sessionId);
    const p = s ? rootProject(s.projectId, projects) : undefined;
    return p ? { name: p.name, color: projectColor(p.id, projects) } : undefined;
  };
  return (
    <section className="away-card" aria-label="While you were away">
      <div className="away-head">
        <b>While you were away</b>
        <span className="muted">since {dayTime(since)} · {relativeTime(since, now)}</span>
        <span className="away-sum">
          <b className={needs.length ? 'warn' : ''}>{needs.length}</b> need you · <b>{featureCount}</b> finished · <b>{data.reports.length}</b> report{data.reports.length === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        <button className="icon-btn" title="Dismiss" aria-label="Dismiss" onClick={() => useAway.getState().dismiss()}>
          ×
        </button>
      </div>
      <div className="away-body">
        {data.autopilots.length > 0 && (
          <div className="away-block">
            <h4>Autopilot</h4>
            {data.autopilots.map((p) => (
              <div key={p.id} className="away-line" style={pcStyle(projectColor(p.id, projects))}>
                <span className="today-proj">{p.name}</span>
                <span>{p.autopilot!.on ? `running · continued ${p.autopilot!.continues}×` : `off — ${p.autopilot!.note ?? ''}`}</span>
                {p.autopilot!.lastAt ? <span className="muted">{relativeTime(p.autopilot!.lastAt, now)}</span> : null}
              </div>
            ))}
          </div>
        )}
        {featureCount > 0 && (
          <div className="away-block">
            <h4>Finished</h4>
            {data.features.map((p) => (
              <div key={p.projectId} className="today-group" style={pcStyle(p.color)}>
                <div className="today-group-name">{p.name}</div>
                {p.rows.map((r) => (
                  <button key={r.key} className="today-row" onClick={() => openFlow(r.order)} title="Flow — who did it, and how it was reported">
                    <span className="today-check">✓</span>
                    <span className="today-title ellipsis">{featureName(r, subjects)}</span>
                    <span className="today-text muted ellipsis">{r.sessionId ? displayTitle(sessions.get(r.sessionId) ?? { title: '' }) : ''}</span>
                    <span className="today-time muted">{dayTime(r.ts)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {data.reports.length > 0 && (
          <div className="away-block">
            <h4>Reports to you</h4>
            {data.reports.slice(0, MAX_REPORTS).map((it) => {
              const p = projectOf(it.sessionId);
              const s = sessions.get(it.sessionId);
              const v = inboxViewOf(it, s?.title);
              return (
                <button key={it.id} className="today-row" onClick={() => selectAndReveal(it.sessionId)} title={v.line}>
                  <span className={`today-kind k-${v.tone === 'question' ? 'question' : 'prompt'}`}>{v.label}</span>
                  {p && <span className="today-proj" style={pcStyle(p.color)}>{p.name}</span>}
                  <span className="today-title ellipsis">{s ? displayTitle(s) : '(removed)'}</span>
                  <span className="today-text ellipsis muted">{v.line}</span>
                  <span className="today-time muted">{dayTime(it.createdAt)}</span>
                </button>
              );
            })}
            {data.reports.length > MAX_REPORTS && <div className="muted today-empty">+{data.reports.length - MAX_REPORTS} more in Inbox</div>}
          </div>
        )}
        {data.autopilots.length === 0 && featureCount === 0 && data.reports.length === 0 && <div className="muted today-empty">Nothing was reported while you were away.</div>}
      </div>
    </section>
  );
}

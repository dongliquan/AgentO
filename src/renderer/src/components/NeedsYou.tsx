import { memo, useEffect, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '@/store';
import { selectAndReveal } from '@/commands';
import { displayTitle, pcStyle, projectColor, projectLabel, relativeTime } from '@/lib/format';
import { dismissNeed, useNeedsYou, type NeedsYou } from '@/lib/needsYou';
import { useNow } from '@/lib/hooks';

/**
 * What waits for the manager, worked out once per window by <NeedsYouWatcher /> and read by the alerts, the Inbox and
 * the Ground cards (ids). Only published when it changes.
 */
export const useNeedsIds = create<{ ids: ReadonlySet<string>; list: NeedsYou[] }>(() => ({ ids: new Set(), list: [] }));

const sig = (list: NeedsYou[]): string => list.map((n) => `${n.key}:${n.at}`).join('|');

export function NeedsYouWatcher(): null {
  const needs = useNeedsYou();
  useEffect(() => {
    const cur = useNeedsIds.getState();
    if (sig(needs) === sig(cur.list)) return;
    useNeedsIds.setState({ ids: new Set(needs.map((n) => n.sessionId)), list: needs });
  }, [needs]);
  return null;
}

/** Open a session that waits for the manager: on the Ground, with its conversation in the right panel. */
export function openNeed(sessionId: string): void {
  selectAndReveal(sessionId);
  useStore.getState().setRightTab('detail');
}

const SHOWN = 4;

/**
 * "Needs you" alerts, above the other toasts: one per session waiting for the manager's decision (a question in its
 * last report, or a prompt in its terminal). Unlike other alerts they stay until clicked — the click opens the
 * session's conversation to answer and clears the alert. Answering the session elsewhere clears it too.
 */
export function NeedsYouAlerts(): JSX.Element | null {
  const needs = useNeedsIds((s) => s.list);
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const now = useNow(30000);
  const [all, setAll] = useState(false);
  if (needs.length === 0) return null;
  const shown = all ? needs : needs.slice(0, SHOWN);
  return (
    <>
      {shown.map((n) => {
        const s = sessions.get(n.sessionId);
        return <NeedAlert key={n.key} need={n} title={s ? displayTitle(s) : '(deleted session)'} project={s?.projectId ?? ''} projects={projects} now={now} />;
      })}
      {needs.length > SHOWN && (
        <button className="need-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `+${needs.length - SHOWN} more waiting for you`}
        </button>
      )}
    </>
  );
}

const NeedAlert = memo(NeedAlertView);

function NeedAlertView({ need: n, title, project, projects, now }: { need: NeedsYou; title: string; project: string; projects: ReturnType<typeof useStore.getState>['projects']; now: number }): JSX.Element {
  const last = n.text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ').replace(/\*\*/g, '');
  return (
    <div
      className={`toast need-alert ${n.kind}`}
      title={n.text}
      onClick={() => {
        dismissNeed(n.key);
        openNeed(n.sessionId);
      }}
    >
      <div className="need-top">
        <span className="needs-badge">Needs you</span>
        {project && <span className="project-tag" style={pcStyle(projectColor(project, projects))}>{projectLabel(project, projects)}</span>}
        <span className="need-title ellipsis">{title}</span>
        <span className="need-time">{relativeTime(n.at, now)}</span>
      </div>
      <div className="need-text">{last}</div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { send } from '@/client';
import { selectAndReveal } from '@/commands';
import { useClosedSessionIds } from '@/lib/closed';
import { dayTime, displayTitle, pcStyle, projectColor, relativeTime, rootProject } from '@/lib/format';
import { useNow } from '@/lib/hooks';

/**
 * Today's "Pick up where you left off": the sessions that are stopped (hibernated after a pause, or stopped when AgentO
 * was closed with its sessions) with what each was last asked and how its last answer ended, newest first, and a
 * button to start it again. After a shutdown that stopped sessions, the ones that were running then come first with
 * one button for all of them. Read from the conversation files the daemon already keeps — nothing asks a session.
 */
const SHOWN = 10;
/** conversation size from which resuming is worth a second thought */
const LONG_CONTEXT = 150_000;
const DISMISS_KEY = 'asm.restorable.dismissed';

const dismissedAt = (): number => {
  try {
    return Number(localStorage.getItem(DISMISS_KEY)) || 0;
  } catch {
    return 0;
  }
};

export function ResumeCard(): JSX.Element | null {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const lastInfo = useStore((s) => s.lastInfo);
  const restorable = useStore((s) => s.restorable);
  const closed = useClosedSessionIds();
  const now = useNow(60_000);
  const [all, setAll] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedAt());

  const wasRunning = useMemo(
    () => (restorable.at > dismissed ? restorable.ids.filter((id) => sessions.get(id)?.status === 'hibernated' && !closed.has(id)) : []),
    [restorable, dismissed, sessions, closed]
  );
  const rows = useMemo(
    () =>
      [...sessions.values()]
        .filter((s) => s.status === 'hibernated' && !closed.has(s.id) && lastInfo.get(s.id))
        .map((s) => ({ s, last: lastInfo.get(s.id)! }))
        .sort((a, b) => b.last.at - a.last.at),
    [sessions, lastInfo, closed]
  );
  if (rows.length === 0 && wasRunning.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  const projectOf = (projectId: string): { name: string; color: string } | undefined => {
    const p = rootProject(projectId, projects);
    return p ? { name: p.name, color: projectColor(p.id, projects) } : undefined;
  };
  const resumeAll = (): void => {
    for (const id of wasRunning) send({ type: 'session.resume', id });
  };
  const dismiss = (): void => {
    const t = restorable.at;
    try {
      localStorage.setItem(DISMISS_KEY, String(t));
    } catch {
      /* not kept */
    }
    setDismissed(t);
  };
  return (
    <section className="resume-card" aria-label="Pick up where you left off">
      {wasRunning.length > 0 && (
        <div className="resume-banner">
          <span>
            <b>{wasRunning.length}</b> session{wasRunning.length === 1 ? ' was' : 's were'} running when AgentO was closed ({dayTime(restorable.at, now)}) and
            {wasRunning.length === 1 ? ' is' : ' are'} stopped now.
          </span>
          <span className="grow" />
          <button className="btn primary sm" onClick={resumeAll}>Resume {wasRunning.length === 1 ? 'it' : 'all'}</button>
          <button className="btn sm ghost" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <h4>
            Pick up where you left off <span className="muted">{rows.length} stopped</span>
          </h4>
          <ul className="resume-list">
            {shown.map(({ s, last }) => {
              const p = projectOf(s.projectId);
              return (
                <li key={s.id} className="resume-row" onClick={() => selectAndReveal(s.id)} title="Show on the Ground">
                  <div className="resume-top" style={p ? pcStyle(p.color) : undefined}>
                    {p && <span className="today-proj">{p.name}</span>}
                    <b className="ellipsis">{displayTitle(s)}</b>
                    <span className="grow" />
                    {(s.context ?? 0) >= LONG_CONTEXT && (
                      <span className="resume-long" title="A long conversation resumes slowly and mixes old and new work — after resuming, consider Fresh Start (card menu)">
                        long · {Math.round((s.context ?? 0) / 1000)}K
                      </span>
                    )}
                    <span className="muted">{relativeTime(last.at, now)}</span>
                    <button
                      className="btn sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        send({ type: 'session.resume', id: s.id });
                      }}
                    >
                      Resume
                    </button>
                  </div>
                  {last.ask && (
                    <div className="resume-line">
                      <span className="resume-tag">Asked</span>
                      <span className="ellipsis">{last.ask}</span>
                    </div>
                  )}
                  {last.reply && (
                    <div className="resume-line">
                      <span className="resume-tag">Left at</span>
                      <span className="ellipsis">{last.reply}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length > SHOWN && (
            <button className="btn sm ghost" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

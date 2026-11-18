import { useEffect, useMemo, useState } from 'react';
import type { DispatchRequest } from '@shared/extra';
import type { Project } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { displayTitle, normPath, pcStyle, projectColor } from '@/lib/format';
import { useToasts } from '@/lib/notify';

/** The open project whose folders hold the repository (the deepest folder wins). */
export function projectOfRepo(repo: string, projects: Project[]): Project | undefined {
  const r = normPath(repo);
  const closed = new Set(projects.filter((p) => p.closed).map((p) => p.id));
  let best: { project: Project; len: number } | undefined;
  for (const p of projects) {
    const root = p;
    if (closed.has(root.id)) continue;
    for (const f of p.folders) {
      const fp = normPath(f.path);
      if ((r === fp || r.startsWith(fp + '\\')) && (!best || fp.length > best.len)) best = { project: root, len: fp.length };
    }
  }
  return best?.project;
}

/** Changed files a commit request names (the list from its ref file, else the count in the link). */
const fileCount = (req: DispatchRequest): number | undefined => req.fileList?.length ?? req.files;

/** The request the picked session receives: what was asked, the data from the link, and the rules (no force, report back). */
export function dispatchOrder(req: DispatchRequest): string {
  const lines = [`[Request from ${req.from} — ${req.kind}]`, `Repository: ${req.repo}`];
  if (req.branch) lines.push(`Branch: ${req.branch}`);
  if (req.kind === 'commit') {
    const n = fileCount(req);
    if (n !== undefined) lines.push(`Changed files: ${n}`);
    if (req.fileList?.length) lines.push(...req.fileList.slice(0, 60).map((f) => `- ${f}`), ...(req.fileList.length > 60 ? [`- … and ${req.fileList.length - 60} more`] : []));
    if (req.msg) lines.push(`Message draft: ${req.msg}`);
    lines.push(
      '',
      'Have the player who works in this repository review these changes and commit them, with a message in the repository\'s usual style (the draft is a starting point). Commit only — do not push. Report back the commit hash, or what stopped it.'
    );
  } else {
    if (req.ahead !== undefined) lines.push(`Commits ahead of the remote: ${req.ahead}`);
    lines.push(
      '',
      'Have the player who works in this repository push these commits to the branch\'s remote. Never force-push; if the push is rejected (the remote moved on), stop and report instead of rebasing on your own. Report back what was pushed.'
    );
  }
  return lines.join('\n');
}

/**
 * Requests from other apps (ReadO's Commit / Push → `agento://dispatch`): the manager confirms each one, and it goes
 * to a session of the project that owns the repository (picked in the dialog) as a message. A repository outside
 * every open project's folders is refused (shown, never sent). Main window only.
 */
export function DispatchDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<DispatchRequest[]>([]);
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  useEffect(
    () =>
      window.desktopEvents?.onDispatch?.(
        (req) => setQueue((q) => [...q, req]),
        (err) => useToasts.getState().push({ title: 'Request not accepted', body: `${err.error}\n${err.url}` })
      ),
    []
  );
  const req = queue[0];
  const project = useMemo(() => (req ? projectOfRepo(req.repo, projects) : undefined), [req, projects]);
  // the sessions that can take it: Claude / Codex sessions of that project, the most recent first
  const candidates = useMemo(
    () =>
      project
        ? [...sessions.values()]
            .filter((s) => s.projectId === project.id && (s.agent === 'claude' || s.agent === 'codex'))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [project, projects, sessions]
  );
  const [targetId, setTargetId] = useState('');
  const target = candidates.find((s) => s.id === targetId) ?? candidates[0];
  const [showFiles, setShowFiles] = useState(false);
  if (!req) return null;
  const next = (): void => {
    setShowFiles(false);
    setQueue((q) => q.slice(1));
  };
  const accept = (): void => {
    if (!project || !target) return;
    const text = dispatchOrder(req);
    // like a message typed in the session: kept in its record, typed in now when it runs, else it is woken first
    send({ type: 'session.note', id: target.id, text });
    const live = target.status === 'working' || target.status === 'waiting' || target.status === 'starting';
    send({ type: live && target.pid !== undefined ? 'session.paste' : 'session.message', id: target.id, text });
    useToasts.getState().push({ title: `Sent to ${displayTitle(target)}`, body: `${req.kind === 'commit' ? 'Commit' : 'Push'} · ${req.repo}` });
    next();
  };
  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) next(); }}>
      <div className="dialog dispatch-dialog" role="dialog" aria-label={`Request from ${req.from}`}>
        <button className="icon-btn dialog-x" onClick={() => next()} title="Close (Esc)" aria-label="Close">×</button>
        <h3>{req.from} asks to {req.kind}</h3>
        <dl className="dispatch-facts">
          <dt>Repository</dt>
          <dd className="mono">{req.repo}</dd>
          {req.branch && (<><dt>Branch</dt><dd className="mono">{req.branch}</dd></>)}
          {req.kind === 'commit' && fileCount(req) !== undefined && (
            <>
              <dt>Changed files</dt>
              <dd>
                {fileCount(req)}
                {!!req.fileList?.length && (
                  <button className="chat-link" onClick={() => setShowFiles(!showFiles)}>{showFiles ? ' hide' : ' show'}</button>
                )}
              </dd>
            </>
          )}
          {req.kind === 'push' && req.ahead !== undefined && (<><dt>Commits ahead</dt><dd>{req.ahead}</dd></>)}
          {req.msg && (<><dt>Message draft</dt><dd>{req.msg}</dd></>)}
        </dl>
        {showFiles && req.fileList && <pre className="dispatch-files">{req.fileList.join('\n')}</pre>}
        {project && target ? (
          <div className="dispatch-to">
            Goes to <span className="project-tag" style={pcStyle(projectColor(project.id, projects))}>{project.name}</span>
            {' · '}
            <select value={target.id} onChange={(e) => setTargetId(e.target.value)}>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>{displayTitle(s)}</option>
              ))}
            </select>
            {' '}as a message. It will {req.kind === 'commit' ? 'commit (no push)' : 'push (never force)'} and tell you the result.
          </div>
        ) : project ? (
          <div className="dispatch-refused">That project has no Claude or Codex session to take this. Start one in it first.</div>
        ) : (
          <div className="dispatch-refused">This repository is not in any open project's folders, so AgentO will not act on it. Add the folder to a project first.</div>
        )}
        <div className="actions">
          {queue.length > 1 && <span className="muted grow">{queue.length - 1} more waiting</span>}
          <button className="btn" onClick={next}>{project ? 'Cancel' : 'Close'}</button>
          {project && target && <button className="btn primary" onClick={accept}>Send to {displayTitle(target)}</button>}
        </div>
      </div>
    </div>
  );
}


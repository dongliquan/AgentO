import { useEffect, useMemo, useState } from 'react';
import type { ClaudeSessionInfo } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { projectLabel, relativeTime } from '@/lib/format';
import { closedProjectIds } from '@/lib/closedIds';

const LARGE = 20 * 1024 * 1024;

function size(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Bring Claude Code sessions started elsewhere (VS Code, a terminal) into a project as players: pick a project folder,
 * tick the conversations found under it, and they are added stopped — they resume that conversation when they get work.
 */
export function ImportClaudeDialog(): JSX.Element | null {
  const preset = useStore((s) => s.importClaude);
  const close = useStore((s) => s.closeImportClaude);
  const allProjects = useStore((s) => s.projects);
  const found = useStore((s) => s.claudeSessions);
  const projects = useMemo(() => {
    const closed = closedProjectIds(allProjects);
    return allProjects.filter((p) => !closed.has(p.id));
  }, [allProjects]);
  /** every folder of every open project / part, as "<project> › <part> · <folder>" */
  const folders = useMemo(
    () => projects.flatMap((p) => p.folders.map((f) => ({ key: `${p.id}|${f.id}`, projectId: p.id, folder: f, label: `${projectLabel(p.id, projects)} · ${f.name}` }))),
    [projects]
  );
  const [pick, setPick] = useState(() => (preset?.projectId && preset.folderId ? `${preset.projectId}|${preset.folderId}` : folders[0]?.key ?? ''));
  const target = folders.find((f) => f.key === pick);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** a session from any folder, by its .jsonl path or id (it keeps running in the folder it started in) */
  const [byId, setById] = useState('');
  const pastedId = byId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const now = Date.now();

  useEffect(() => {
    if (target) send({ type: 'claude.sessions.list', path: target.folder.path });
    setChecked(new Set());
  }, [target?.folder.path]);

  if (!preset) return null;
  const items: ClaudeSessionInfo[] = found && target && found.path === target.folder.path ? found.items : [];
  const loading = !!target && (!found || found.path !== target.folder.path);
  const toggle = (id: string): void => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };
  const ids = [...checked, ...(pastedId && !checked.has(pastedId) ? [pastedId] : [])];
  const doImport = (): void => {
    if (!target || ids.length === 0) return;
    send({ type: 'claude.sessions.import', projectId: target.projectId, folderId: target.folder.id, ids });
    close();
  };

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog import-claude">
        <h3>Import Claude Code Sessions</h3>
        <div className="muted field-hint">
          Conversations started in VS Code or a terminal. They join the project as players, stopped, and continue the same
          conversation when they get work. Close them in VS Code first — one conversation should not run in two places.
        </div>
        <div className="field">
          <label>Into project folder</label>
          {folders.length === 0 ? (
            <span className="muted">Add a folder to a project first.</span>
          ) : (
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {folders.map((f) => (
                <option key={f.key} value={f.key}>{`${f.label} — ${f.folder.path}`}</option>
              ))}
            </select>
          )}
        </div>
        <div className="import-list">
          {loading && <div className="muted">Looking for sessions…</div>}
          {!loading && target && items.length === 0 && <div className="muted">No Claude Code sessions under this folder.</div>}
          {items.map((it) => {
            const sub = it.cwd.toLowerCase() !== target!.folder.path.toLowerCase() ? it.cwd.slice(target!.folder.path.length).replace(/^[\\/]/, '') : '';
            return (
              <label key={it.id} className={`import-row ${it.inAgento ? 'done' : ''}`} title={it.firstPrompt ?? it.title}>
                <input type="checkbox" disabled={!!it.inAgento} checked={checked.has(it.id)} onChange={() => toggle(it.id)} />
                <span className="import-main">
                  <span className="import-title">{it.title}</span>
                  <span className="import-meta">
                    {relativeTime(it.updatedAt, now)} · {size(it.size)}
                    {sub && <> · {sub}</>}
                    {it.inAgento && <span className="import-tag">in AgentO: {it.inAgento}</span>}
                    {!it.inAgento && it.active && <span className="import-tag warn">open elsewhere?</span>}
                    {!it.inAgento && it.size > LARGE && <span className="import-tag warn">large — costly to continue</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="field">
          <label>Or a session from another folder</label>
          <input value={byId} placeholder="Paste its .jsonl path or session id" onChange={(e) => setById(e.target.value)} />
          {byId.trim() && !pastedId && <div className="muted field-hint">No session id found in this text.</div>}
        </div>
        <div className="actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={ids.length === 0} onClick={doImport}>
            Import{ids.length ? ` ${ids.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

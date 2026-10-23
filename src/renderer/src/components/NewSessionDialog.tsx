import { useEffect, useMemo, useState } from 'react';
import type { AgentKind } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { newProject } from '@/commands';
import { AGENT_LABELS, agentColor, projectLabel } from '@/lib/format';
import { closedProjectIds } from '@/lib/closed';
import { AgentIcon } from './AgentIcon';

const DEFAULT_KINDS: AgentKind[] = ['claude', 'codex', 'gemini', 'ollama', 'shell'];

export function NewSessionDialog(): JSX.Element {
  const close = useStore((s) => s.closeNewSession);
  const preset = useStore((s) => s.newSessionPreset);
  const allProjects = useStore((s) => s.projects);
  // only open projects take new sessions
  const projects = useMemo(() => {
    const closed = closedProjectIds(allProjects);
    return allProjects.filter((p) => !closed.has(p.id));
  }, [allProjects]);
  const agents = useStore((s) => s.agents);

  const [projectId, setProjectId] = useState(preset.projectId ?? projects[0]?.id ?? '');
  const project = projects.find((p) => p.id === projectId);
  const [folderId, setFolderId] = useState(preset.folderId ?? project?.folders[0]?.id ?? '');
  const [agent, setAgent] = useState<AgentKind>((preset.agent as AgentKind) ?? 'claude');
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  // keep folder valid when project changes / folders arrive
  useEffect(() => {
    const p = projects.find((x) => x.id === projectId);
    if (!p) {
      if (projects[0]) setProjectId(projects[0].id);
      return;
    }
    if (!p.folders.some((f) => f.id === folderId)) setFolderId(p.folders[0]?.id ?? '');
  }, [projects, projectId, folderId]);

  const agentList = useMemo(
    () => (agents.length ? agents : DEFAULT_KINDS.map((kind) => ({ kind, label: AGENT_LABELS[kind], command: '', args: [], color: agentColor(kind), available: undefined }))),
    [agents]
  );
  const folder = project?.folders.find((f) => f.id === folderId);
  // the session belongs to the project; the folder only sets its working directory (cwd)
  const canCreate = Boolean(project && folder);

  const addFolder = async (): Promise<void> => {
    if (!projectId) return;
    setAdding(true);
    try {
      const path = await window.desktop.pickFolder();
      if (path) send({ type: 'folder.add', projectId, path });
    } finally {
      setAdding(false);
    }
  };

  const create = (): void => {
    if (!canCreate) return;
    send({
      type: 'session.create',
      projectId,
      folderId,
      agent,
      title: title.trim() || `${AGENT_LABELS[agent]} · ${folder?.name ?? ''}`.trim(),
      cols: 100,
      rows: 30
    });
    close();
  };

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') create(); }}>
        <button className="icon-btn dialog-x" onClick={() => close()} title="Close (Esc)" aria-label="Close">×</button>
        <h3>New Session</h3>
        <div className="field">
          <label>Project</label>
          {projects.length === 0 ? (
            <div className="row">
              <span className="muted">No projects yet.</span>
              <button className="btn sm" onClick={() => void newProject()}>Create Project</button>
            </div>
          ) : (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{projectLabel(p.id, projects)}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label>Working folder</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select style={{ flex: 1 }} value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!project || project.folders.length === 0}>
              {(project?.folders ?? []).map((f) => <option key={f.id} value={f.id}>{f.name} — {f.path}</option>)}
              {(!project || project.folders.length === 0) && <option value="">No folders</option>}
            </select>
            <button className="btn sm" disabled={!projectId || adding} onClick={() => void addFolder()}>Add Folder…</button>
          </div>
          {project && project.folders.length === 0 && <div className="muted field-hint">Add a folder to set the working directory</div>}
        </div>
        <div className="field">
          <label>Agent</label>
          <div className="radios">
            {agentList.map((a) => (
              <label key={a.kind} className={`radio ${agent === a.kind ? 'active' : ''} ${a.available === false ? 'unavailable' : ''}`} title={a.available === false ? `${a.command} not found` : a.command}>
                <input type="radio" name="agent" style={{ display: 'none' }} checked={agent === a.kind} onChange={() => setAgent(a.kind)} />
                <AgentIcon kind={a.kind} color={a.color} />
                {a.label || AGENT_LABELS[a.kind]}
                {a.available === false && <span className="muted" style={{ fontSize: 10 }}>Not installed</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Title (optional)</label>
          <input autoFocus value={title} placeholder={`${AGENT_LABELS[agent]} · ${folder?.name ?? ''}`} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!canCreate} onClick={create}>Start Session</button>
        </div>
      </div>
    </div>
  );
}

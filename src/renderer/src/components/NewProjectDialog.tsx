import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '@/store';
import { send } from '@/client';
import { imageFiles, useAttachments, withAttachments } from '@/lib/attachments';
import { AttachmentBar } from './AttachmentBar';
import { kbd } from '@/lib/keys';

/** The New Project dialog (Ground toolbar, PROJECTS +, the order box): open state and the last project it made. */
export const useNewProject = create<{ open: boolean; made: string; show: () => void; hide: () => void; setMade: (name: string) => void }>((set) => ({
  open: false,
  made: '',
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  setMade: (made) => set({ made })
}));

/**
 * A new project: name, the folders it works in, and an optional brief. With a brief, AgentO also makes its head coach
 * and gives it the brief (it designs the parts and players; "report the plan first" makes it wait for your go). Without
 * one, only the project (and its folders) is made.
 */
export function NewProjectDialog(): JSX.Element | null {
  const open = useNewProject((s) => s.open);
  const hide = useNewProject((s) => s.hide);
  const setMade = useNewProject((s) => s.setMade);
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [brief, setBrief] = useState('');
  const [planFirst, setPlanFirst] = useState(true);
  const files = useAttachments();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);
  if (!open) return null;

  const reset = (): void => {
    setName('');
    setFolders([]);
    setBrief('');
    files.clear();
  };
  const can = name.trim() !== '' && !files.busy;
  const submit = (): void => {
    if (!can) return;
    const n = name.trim();
    if (brief.trim()) {
      // the head coach is made and briefed; no folder: one is made under AgentO Projects
      send({ type: 'project.start', name: n, folders, text: withAttachments(brief.trim(), files.items), plan: planFirst });
    } else {
      // only the project; its folders are added once the daemon has made it
      const before = new Set(useStore.getState().projects.map((p) => p.id));
      send({ type: 'project.create', name: n });
      if (folders.length) {
        const picked = [...folders];
        const stop = useStore.subscribe((st) => {
          const made = st.projects.find((p) => !before.has(p.id) && !p.parentId && p.name === n);
          if (!made) return;
          stop();
          for (const f of picked) send({ type: 'folder.add', projectId: made.id, path: f, autoTrust: true });
        });
        setTimeout(stop, 15_000);
      }
    }
    setMade(n);
    useStore.getState().setRightTab('orders');
    reset();
    hide();
  };

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="dialog new-project-dialog" role="dialog" aria-label="New project">
        <h3>New Project</h3>
        <div className="new-project-row">
          <input ref={nameRef} value={name} placeholder="Project name" onChange={(e) => setName(e.target.value)} />
          <button
            className="btn sm"
            title="A folder the project works in"
            onClick={() =>
              void window.desktop.pickFolder().then((d) => {
                if (d && !folders.includes(d)) setFolders([...folders, d]);
              })
            }
          >
            + Folder
          </button>
        </div>
        {folders.length > 0 ? (
          <div className="new-folders">
            {folders.map((f) => (
              <span key={f} className="new-folder" title={f}>
                <span className="ellipsis">{f}</span>
                <button className="attach-x static" onClick={() => setFolders(folders.filter((x) => x !== f))} title="Remove">×</button>
              </span>
            ))}
          </div>
        ) : (
          <div className="muted new-folder-hint">
            {brief.trim() ? `No folder: a new one is made — AgentO Projects\\${name.trim() || '<name>'}` : 'No folder yet — you can add folders later.'}
          </div>
        )}
        <textarea
          value={brief}
          rows={5}
          placeholder="Brief (optional): what to build and how. With a brief, a head coach is made and designs the team. Paste or drop images."
          onChange={(e) => setBrief(e.target.value)}
          onPaste={(e) => {
            const imgs = imageFiles(e.clipboardData);
            if (imgs.length) {
              e.preventDefault();
              files.add(imgs);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const imgs = imageFiles(e.dataTransfer);
            if (imgs.length) {
              e.preventDefault();
              files.add(imgs);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <AttachmentBar items={files.items} onRemove={files.remove} />
        <div className="actions">
          <label className="new-plan" title="On: the head coach reports its team and plan, and waits for your go. Off: it starts the work right away.">
            <input type="checkbox" checked={planFirst} disabled={!brief.trim()} onChange={(e) => setPlanFirst(e.target.checked)} />
            Report the plan first and wait for my go
          </label>
          <span className="grow" />
          <button className="btn sm" onClick={hide}>Cancel</button>
          <button className="btn sm primary" disabled={!can} onClick={submit} title={kbd('Ctrl+Enter')}>
            {brief.trim() ? 'Start Project' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

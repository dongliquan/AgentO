import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '@/store';
import { send } from '@/client';
import { kbd } from '@/lib/keys';

/** The New Project dialog (Ground toolbar, PROJECTS +): open state and the last project it made. */
export const useNewProject = create<{ open: boolean; made: string; show: () => void; hide: () => void; setMade: (name: string) => void }>((set) => ({
  open: false,
  made: '',
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  setMade: (made) => set({ made })
}));

/** A new project: a name and the folders its sessions work in (they can be added later). */
export function NewProjectDialog(): JSX.Element | null {
  const open = useNewProject((s) => s.open);
  const hide = useNewProject((s) => s.hide);
  const setMade = useNewProject((s) => s.setMade);
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
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

  const can = name.trim() !== '';
  const submit = (): void => {
    if (!can) return;
    const n = name.trim();
    // the project first; its folders are added once the daemon has made it
    const before = new Set(useStore.getState().projects.map((p) => p.id));
    send({ type: 'project.create', name: n });
    if (folders.length) {
      const picked = [...folders];
      const stop = useStore.subscribe((st) => {
        const made = st.projects.find((p) => !before.has(p.id) && !p.parentId && p.name === n);
        if (!made) return;
        stop();
        for (const f of picked) send({ type: 'folder.add', projectId: made.id, path: f });
      });
      setTimeout(stop, 15_000);
    }
    setMade(n);
    setName('');
    setFolders([]);
    hide();
  };

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) hide(); }}>
      <div className="dialog new-project-dialog" role="dialog" aria-label="New project">
        <button className="icon-btn dialog-x" onClick={() => hide()} title="Close (Esc)" aria-label="Close">×</button>
        <h3>New Project</h3>
        <div className="new-project-row">
          <input
            ref={nameRef}
            value={name}
            placeholder="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
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
          <div className="muted new-folder-hint">No folder yet — you can add folders later.</div>
        )}
        <div className="actions">
          <span className="grow" />
          <button className="btn sm" onClick={hide}>Cancel</button>
          <button className="btn sm primary" disabled={!can} onClick={submit} title={kbd('Enter')}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}

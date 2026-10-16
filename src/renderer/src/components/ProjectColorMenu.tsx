import { create } from 'zustand';
import { PROJECT_COLORS } from '@shared/protocol';
import { send } from '@/client';
import { useStore } from '@/store';
import { projectColor } from '@/lib/format';
import { useEscape } from '@/lib/hooks';

/** The color picker a project's color dot opens: the palette, or any color. */
export const useColorMenu = create<{ at: { x: number; y: number; projectId: string } | null; show: (at: { x: number; y: number; projectId: string }) => void; hide: () => void }>((set) => ({
  at: null,
  show: (at) => set({ at }),
  hide: () => set({ at: null })
}));

export function ProjectColorMenu(): JSX.Element | null {
  const at = useColorMenu((s) => s.at);
  const hide = useColorMenu((s) => s.hide);
  const projects = useStore((s) => s.projects);
  useEscape(!!at, hide);
  if (!at) return null;
  const project = projects.find((p) => p.id === at.projectId);
  if (!project) return null;
  const cur = projectColor(project.id, projects).toLowerCase();
  const pick = (color: string): void => {
    send({ type: 'project.setColor', id: project.id, color });
    hide();
  };
  return (
    <>
      <div className="fileref-scrim" onMouseDown={hide} />
      <div className="popover pc-menu" style={{ left: Math.min(at.x, window.innerWidth - 200), top: Math.min(at.y + 6, window.innerHeight - 130) }}>
        <div className="pc-menu-title muted ellipsis">{project.name} — color</div>
        <div className="pc-menu-grid">
          {PROJECT_COLORS.map((c) => (
            <button key={c} className={`pc-swatch ${c.toLowerCase() === cur ? 'on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => pick(c)} />
          ))}
        </div>
        <label className="item pc-custom" title="Any color">
          <input type="color" defaultValue={cur} onChange={(e) => send({ type: 'project.setColor', id: project.id, color: e.target.value })} />
          Custom…
        </label>
      </div>
    </>
  );
}

import { memo, useMemo } from 'react';
import type React from 'react';
import type { Project, Session } from '@shared/protocol';
import { useStore } from '@/store';
import { send } from '@/client';
import { startDrag } from '@/lib/drag';
import { groupLayout, shownRect, type GroupLayout } from '@/lib/groups';
import { pcStyle, projectColor, statusClass, statusLabel } from '@/lib/format';

const PAD = 24;
/** room above the cards for the label */
const LABEL_H = 30;
/** a project frame wraps its parts' frames */
const OUTER_PAD = 52;
const OUTER_LABEL_H = 34;

/** A drag on a label ends with a click event; this swallows that click so it does not also toggle the group. */
let dragEndedAt = 0;

/**
 * Groups on the Ground, always shown: a labelled frame around each part's sessions (coach and players), and a larger
 * one around a whole project (its head coach and every part). Click a label to collapse / expand the group (a collapsed
 * group is a small box: name, size, status dots); drag a label to move the group. Drawn under the cards and links.
 */
function GroundGroupsImpl({ layout }: { layout: GroupLayout }): JSX.Element {
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const collapsed = useStore((s) => s.collapsedGroups);
  const toggle = useStore((s) => s.toggleGroup);

  const all = [...sessions.values()];
  const tops = projects.filter((p) => !p.parentId && !p.closed);
  const partsOf = (id: string): Project[] => projects.filter((p) => p.parentId === id);
  const frame = (members: Session[], pad: number, label: number) => {
    const rects = members.map((s) => shownRect(s, layout));
    return {
      x: Math.min(...rects.map((r) => r.x)) - pad,
      y: Math.min(...rects.map((r) => r.y)) - pad - label,
      r: Math.max(...rects.map((r) => r.x + r.w)) + pad,
      b: Math.max(...rects.map((r) => r.y + r.h)) + pad
    };
  };
  const label = (g: Project, members: Session[], kind: string): JSX.Element => (
    <div
      className="ground-group-label"
      title={`Click to ${collapsed.includes(g.id) ? 'expand' : 'collapse'} · drag to move the whole ${kind}`}
      onPointerDown={(e) => moveGroup(e, members)}
      onClick={(e) => {
        e.stopPropagation();
        if (Date.now() - dragEndedAt > 300) toggle(g.id);
      }}
    >
      <span className="caret">{collapsed.includes(g.id) ? '▸' : '▾'}</span>
      {g.name}
      <span className="count">{members.length}</span>
    </div>
  );

  const out: JSX.Element[] = [];
  for (const top of tops) {
    const parts = partsOf(top.id);
    const members = all.filter((s) => s.projectId === top.id || parts.some((p) => p.id === s.projectId));
    if (members.length === 0) continue;
    const box = layout.boxes.get(top.id);
    if (box) {
      out.push(<CollapsedBox key={top.id} project={top} members={members} box={box} label={label(top, members, 'project')} />);
      continue;
    }
    // every project gets its frame, around all its sessions (head coach included); parts get their own frames inside
    const f = frame(members, parts.length > 0 ? OUTER_PAD : PAD, parts.length > 0 ? OUTER_LABEL_H : LABEL_H);
    out.push(
      <div key={top.id} className="ground-group project" style={{ left: f.x, top: f.y, width: f.r - f.x, height: f.b - f.y, ...pcStyle(projectColor(top.id, projects)) }}>
        {label(top, members, 'project')}
      </div>
    );
    for (const g of parts) {
      const m = all.filter((s) => s.projectId === g.id && s.role !== 'head');
      if (m.length === 0) continue;
      const kind = g.parentId ? 'part' : 'project';
      const pbox = layout.boxes.get(g.id);
      if (pbox) {
        out.push(<CollapsedBox key={g.id} project={g} members={m} box={pbox} label={label(g, m, kind)} />);
        continue;
      }
      const f = frame(m, PAD, LABEL_H);
      out.push(
        <div key={g.id} className={`ground-group ${g.parentId ? 'part' : ''}`} style={{ left: f.x, top: f.y, width: f.r - f.x, height: f.b - f.y }}>
          {label(g, m, kind)}
        </div>
      );
    }
  }
  return <>{out}</>;
}

/** A collapsed group: its label, and one status dot per hidden session (title on hover). */
function CollapsedBox({ project, members, box, label }: { project: Project; members: Session[]; box: { x: number; y: number; w: number; h: number }; label: JSX.Element }): JSX.Element {
  const working = members.filter((s) => s.status === 'working' || s.status === 'starting').length;
  return (
    <div className={`ground-group collapsed ${project.parentId ? 'part' : 'project'}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...pcStyle(projectColor(project.id, useStore.getState().projects)) }}>
      {label}
      <div className="collapsed-dots">
        {members.map((s) => (
          <span key={s.id} className={`status-dot ${statusClass(s)}`} title={`${s.title} · ${statusLabel(s)}`} />
        ))}
        <span className="muted">{working ? `${working} working` : 'idle'}</span>
      </div>
    </div>
  );
}

/** Drag every member card by the same delta; positions persist through the daemon on drop. */
function moveGroup(e: React.PointerEvent, members: Session[]): void {
  e.stopPropagation();
  const origin = members.map((s) => ({ id: s.id, x: s.x, y: s.y }));
  let last = { dx: 0, dy: 0 };
  startDrag(e, {
    scale: () => useStore.getState().zoom,
    onMove: (dx, dy) => {
      last = { dx: Math.round(dx), dy: Math.round(dy) };
      const st = useStore.getState();
      for (const o of origin) st.patchSessionLocal(o.id, { x: o.x + last.dx, y: o.y + last.dy });
    },
    onEnd: () => {
      dragEndedAt = Date.now();
      for (const o of origin) send({ type: 'session.update', id: o.id, patch: { x: o.x + last.dx, y: o.y + last.dy } });
    }
  });
}

/** Group layout for the current Ground (which cards collapsed groups hide, and where their boxes are). */
export function useGroupLayout(): GroupLayout {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const collapsed = useStore((s) => s.collapsedGroups);
  // memoized: the same object while nothing changed, so the memoized frames and links skip pan / zoom renders
  return useMemo(() => groupLayout([...sessions.values()], projects, new Set(collapsed)), [sessions, projects, collapsed]);
}

/** Re-renders only when its own props change — not on every pan / zoom frame of the Ground. */
export const GroundGroups = memo(GroundGroupsImpl);

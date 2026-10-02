import type { Project, Session } from '@shared/protocol';

/** Size of a collapsed group on the Ground. */
export const COLLAPSED = { w: 300, h: 92 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupLayout {
  /** session id → id of the collapsed group hiding it (a closed project hides its cards without a box) */
  hidden: Map<string, string>;
  /** collapsed group id → its box (at the top-left of its members) */
  boxes: Map<string, Rect>;
}

/**
 * Which cards a collapsed group hides, and where its box sits. A project collapses with its head coach and every part;
 * a part (or a project without parts) collapses its coach and players.
 */
export function groupLayout(sessions: Session[], projects: Project[], collapsed: ReadonlySet<string>): GroupLayout {
  const hidden = new Map<string, string>();
  const boxes = new Map<string, Rect>();
  const hide = (groupId: string, members: Session[]): void => {
    if (members.length === 0) return;
    boxes.set(groupId, { x: Math.min(...members.map((s) => s.x)), y: Math.min(...members.map((s) => s.y)), ...COLLAPSED });
    for (const s of members) hidden.set(s.id, groupId);
  };
  for (const top of projects.filter((p) => !p.parentId)) {
    const parts = projects.filter((p) => p.parentId === top.id);
    if (top.closed) {
      for (const s of sessions) if (s.projectId === top.id || parts.some((p) => p.id === s.projectId)) hidden.set(s.id, top.id);
      continue;
    }
    if (collapsed.has(top.id)) {
      hide(top.id, sessions.filter((s) => s.projectId === top.id || parts.some((p) => p.id === s.projectId)));
      continue;
    }
    for (const g of parts.length ? parts : [top]) {
      if (collapsed.has(g.id)) hide(g.id, sessions.filter((s) => s.projectId === g.id && s.role !== 'head'));
    }
  }
  return { hidden, boxes };
}

/** A card that is not on the Ground at all: its project is closed (hidden, but no collapsed box). */
export function offGround(id: string, layout: GroupLayout): boolean {
  const g = layout.hidden.get(id);
  return g !== undefined && !layout.boxes.has(g);
}

/** Where a session is drawn: its card, or the box of the collapsed group hiding it. */
export function shownRect(s: Session, layout: GroupLayout): Rect {
  const g = layout.hidden.get(s.id);
  return (g && layout.boxes.get(g)) || s;
}

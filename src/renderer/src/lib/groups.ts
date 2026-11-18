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

/** Which cards a collapsed project hides, and where its box sits. */
export function groupLayout(sessions: Session[], projects: Project[], collapsed: ReadonlySet<string>): GroupLayout {
  const hidden = new Map<string, string>();
  const boxes = new Map<string, Rect>();
  const hide = (groupId: string, members: Session[]): void => {
    if (members.length === 0) return;
    boxes.set(groupId, { x: Math.min(...members.map((s) => s.x)), y: Math.min(...members.map((s) => s.y)), ...COLLAPSED });
    for (const s of members) hidden.set(s.id, groupId);
  };
  for (const p of projects) {
    if (p.closed) {
      for (const s of sessions) if (s.projectId === p.id) hidden.set(s.id, p.id);
      continue;
    }
    if (collapsed.has(p.id)) hide(p.id, sessions.filter((s) => s.projectId === p.id));
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

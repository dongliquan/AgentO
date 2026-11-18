/**
 * Card sizes and the layout of the Ground, shared by the renderer (Auto Arrange) and the daemon (new sessions).
 */
import type { Project, Session } from './protocol';

/**
 * Every session works in a tall card (9:16, a conversation reads top to bottom), sized to work in at 100% zoom (a
 * readable chat and terminal), not just to watch.
 */
export const CARD_PORTRAIT = { w: 600, h: 1068 };

/** spacing between cards in a row, between rows, and between projects */
const GAP_X = 64;
const GAP_ROW = 120;
const GAP_PROJECT = 220;
/** cards per row inside a project: the rest wrap below, so a big project grows down instead of across */
export const CARDS_PER_ROW = 4;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One block per project, in the sidebar's order, one under another: its sessions in rows of CARDS_PER_ROW (the tree's
 * order, then creation time). Sessions of an unknown project go last. Returns the new rectangle of every session.
 */
export function arrangeSimple(sessions: Session[], projects: Project[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const P = CARD_PORTRAIT;
  const order = (a: Session, b: Session): number => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt;
  const ids = projects.map((p) => p.id);
  const groups = new Map<string, Session[]>();
  for (const s of [...sessions].sort(order)) {
    const key = ids.includes(s.projectId) ? s.projectId : '';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  let y = 0;
  for (const key of [...ids, '']) {
    const members = groups.get(key);
    if (!members?.length) continue;
    members.forEach((s, i) => {
      const col = i % CARDS_PER_ROW;
      const row = Math.floor(i / CARDS_PER_ROW);
      out.set(s.id, { x: col * (P.w + GAP_X), y: y + row * (P.h + GAP_ROW), w: P.w, h: P.h });
    });
    y += Math.ceil(members.length / CARDS_PER_ROW) * (P.h + GAP_ROW) + GAP_PROJECT;
  }
  return out;
}

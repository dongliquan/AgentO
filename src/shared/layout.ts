/**
 * Card sizes and the team layout of the Ground, shared by the renderer (Auto Arrange) and the daemon (new sessions,
 * the built-in demo).
 */
import type { Project, Session, SessionRole } from './protocol';

/**
 * Players work in a tall card (9:16, a conversation reads top to bottom); head coaches and coaches in a wide one (16:9).
 * Sized to work in at 100% zoom (a readable chat and terminal), not just to watch.
 */
export const CARD_PORTRAIT = { w: 600, h: 1068 };
export const CARD_LANDSCAPE = { w: 1068, h: 600 };
/** the head coach: the same wide card as a coach (it used to be 1.5x, which crowded the Ground) */
export const CARD_HEAD = CARD_LANDSCAPE;

export function cardSize(role: SessionRole): { w: number; h: number } {
  return role === 'player' ? CARD_PORTRAIT : role === 'head' ? CARD_HEAD : CARD_LANDSCAPE;
}

/** spacing: rows leave room for the Ground's link arcs and the group labels; blocks and projects sit further apart */
const GAP_X = 64;
const GAP_Y = 180;
const GAP_BLOCK = 160;
/** projects stand well apart, so their group frames and the minimap read as separate blocks */
const GAP_PROJECT = 720;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Team layout, like a pitch, so links run through empty space instead of under cards. Projects side by side; in a
 * project its head coach on top (centered), then one block per part — the coach on top, the players in a row below.
 * Returns the new rectangle of every session it places.
 */
export function arrangeTeam(sessions: Session[], projects: Project[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  // a part's own order (drag and drop in the tree) first, then creation time
  const all = [...sessions].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt);
  const L = CARD_LANDSCAPE;
  const P = CARD_PORTRAIT;
  const H = CARD_HEAD;
  const place = (s: Session, x: number, y: number): void => {
    const size = cardSize(s.role);
    out.set(s.id, { x: Math.round(x), y: Math.round(y), w: size.w, h: size.h });
  };
  const known = new Set(projects.map((p) => p.id));

  // a team-wide head coach (earlier design) sits above everything
  const teamHead = all.find((s) => s.role === 'head' && !s.projectId);
  const top0 = teamHead ? H.h + GAP_Y : 0;
  const roots = [...projects.filter((p) => !p.parentId).map((p) => p.id), ...new Set(all.filter((s) => s.projectId && !known.has(s.projectId)).map((s) => s.projectId))];
  let x = 0;
  for (const root of roots) {
    const head = all.find((s) => s.role === 'head' && s.projectId === root);
    const blocks = [root, ...projects.filter((p) => p.parentId === root).map((p) => p.id)]
      .map((pid) => {
        const members = all.filter((s) => s.role !== 'head' && s.projectId === pid);
        return { coach: members.find((s) => s.role === 'coach'), players: members.filter((s) => s.role !== 'coach') };
      })
      .filter((b) => b.coach || b.players.length);
    if (!head && blocks.length === 0) continue;
    const top = top0 + (head ? H.h + GAP_Y : 0);
    const start = x;
    for (const b of blocks) {
      const playersW = b.players.length ? b.players.length * (P.w + GAP_X) - GAP_X : 0;
      const width = Math.max(playersW, b.coach ? L.w : 0);
      if (b.coach) place(b.coach, x + (width - L.w) / 2, top);
      const py = b.coach ? top + L.h + GAP_Y : top;
      b.players.forEach((p, i) => place(p, x + (width - playersW) / 2 + i * (P.w + GAP_X), py));
      x += width + GAP_BLOCK;
    }
    if (blocks.length === 0) x += L.w + GAP_BLOCK;
    // a project narrower than its head coach's card widens to it, so the next project does not slide under it
    if (head && x - GAP_BLOCK - start < H.w) x = start + H.w + GAP_BLOCK;
    const width = x - GAP_BLOCK - start;
    if (head) place(head, start + (width - H.w) / 2, top0);
    x += GAP_PROJECT - GAP_BLOCK;
  }
  if (teamHead) place(teamHead, Math.max(0, (x - GAP_PROJECT - H.w) / 2), 0);
  return out;
}

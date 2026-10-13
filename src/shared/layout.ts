/**
 * Card sizes and the team layout of the Ground, shared by the renderer (Auto Arrange) and the daemon (new sessions,
 * the built-in demo).
 */
import type { Project, Session, SessionRole } from './protocol';

/**
 * Players and a project's head coach work in a tall card (9:16, a conversation reads top to bottom); part coaches and
 * the team-wide head coach in a wide one (16:9).
 * Sized to work in at 100% zoom (a readable chat and terminal), not just to watch.
 */
export const CARD_PORTRAIT = { w: 600, h: 1068 };
export const CARD_LANDSCAPE = { w: 1068, h: 600 };
/** a project's head coach ("Coach" in the UI): tall like a player's card, a little longer than 9:16 */
export const CARD_HEAD = { w: 600, h: 1300 };

/** Card size of a role; the team-wide head coach (no project, "Head Coach" in the UI) keeps the wide card. */
export function cardSize(role: SessionRole, projectId?: string): { w: number; h: number } {
  if (role === 'head') return projectId ? CARD_HEAD : CARD_LANDSCAPE;
  return role === 'player' ? CARD_PORTRAIT : CARD_LANDSCAPE;
}

/**
 * spacing. CORRIDOR: the empty column between a head coach and its parts, where its links run (they never cross a
 * card on their way to a part). PART_GAP leaves room for a part's frame and label; projects sit far apart.
 */
const GAP_X = 64;
const GAP_ROW = 120;
const CORRIDOR = 280;
const PART_GAP = 220;
const GAP_PROJECT = 720;
/** players per row inside a part: the rest wrap below, so a big part grows down instead of across */
export const PLAYERS_PER_ROW = 4;
/** projects side by side in a row; the next ones start a new row below */
export const PROJECTS_PER_ROW = 3;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Team layout. Projects side by side, PROJECTS_PER_ROW to a row (more start a new row below). In a project: the head coach in the left column (centred on its
 * parts), an empty corridor for its links, then the parts as rows one under another — each part its coach (if any)
 * and its players, PLAYERS_PER_ROW to a row. The Ground stays roughly square and every part reads as one block.
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
    const size = cardSize(s.role, s.projectId);
    out.set(s.id, { x: Math.round(x), y: Math.round(y), w: size.w, h: size.h });
  };
  const known = new Set(projects.map((p) => p.id));

  // a team-wide head coach (earlier design) sits above everything
  const teamHead = all.find((s) => s.role === 'head' && !s.projectId);
  if (teamHead) place(teamHead, 0, 0);
  const startY = teamHead ? L.h + GAP_PROJECT / 2 : 0;
  const roots = [...projects.filter((p) => !p.parentId).map((p) => p.id), ...new Set(all.filter((s) => s.projectId && !known.has(s.projectId)).map((s) => s.projectId))];
  // each project laid out from (0, 0) first, then placed in the grid: PROJECTS_PER_ROW side by side, then the next row
  let col = 0;
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const root of roots) {
    const head = all.find((s) => s.role === 'head' && s.projectId === root);
    const blocks = [root, ...projects.filter((p) => p.parentId === root).map((p) => p.id)]
      .map((pid) => {
        const members = all.filter((s) => s.role !== 'head' && s.projectId === pid);
        return { coach: members.find((s) => s.role === 'coach'), players: members.filter((s) => s.role !== 'coach') };
      })
      .filter((b) => b.coach || b.players.length);
    if (!head && blocks.length === 0) continue;
    const local: [Session, number, number][] = [];
    const partsX = head ? H.w + CORRIDOR : 0;
    let width = head ? H.w : 0;
    let py = 0;
    for (const b of blocks) {
      if (b.coach) {
        local.push([b.coach, partsX, py]);
        width = Math.max(width, partsX + L.w);
        py += L.h + GAP_ROW;
      }
      b.players.forEach((p, i) => {
        const row = Math.floor(i / PLAYERS_PER_ROW);
        const px = partsX + (i % PLAYERS_PER_ROW) * (P.w + GAP_X);
        local.push([p, px, py + row * (P.h + GAP_ROW)]);
        width = Math.max(width, px + P.w);
      });
      const rows = Math.ceil(b.players.length / PLAYERS_PER_ROW);
      py += rows ? rows * (P.h + GAP_ROW) : 0;
      py += PART_GAP - GAP_ROW;
    }
    // py ends one PART_GAP below the last row
    const partsH = blocks.length ? py - PART_GAP : 0;
    const height = Math.max(head ? H.h : 0, partsH);
    // the head coach faces the middle of its parts, so its links fan out evenly
    if (head) local.push([head, 0, Math.max(0, (height - H.h) / 2)]);
    if (col === PROJECTS_PER_ROW) {
      col = 0;
      x = 0;
      y += rowH + GAP_PROJECT;
      rowH = 0;
    }
    for (const [s2, lx, ly] of local) place(s2, x + lx, y + ly);
    x += width + GAP_PROJECT;
    rowH = Math.max(rowH, height);
    col++;
  }
  return out;
}

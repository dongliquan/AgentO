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

/** the team-wide head coach ("Head Coach" in the UI), in the middle of the Ground: a larger wide card */
export const CARD_TEAM_HEAD = { w: 1340, h: 1080 };

/** Card size of a role; the team-wide head coach (no project) has its own larger wide card. */
export function cardSize(role: SessionRole, projectId?: string): { w: number; h: number } {
  if (role === 'head') return projectId ? CARD_HEAD : CARD_TEAM_HEAD;
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
/** between the Head Coach in the middle and the projects around it: room for the links and the projects' labels */
const GAP_RING = 360;
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
 * Team layout. With a team-wide Head Coach: it sits in the middle, the projects in the cells around it. Without
 * one: projects side by side, PROJECTS_PER_ROW to a row (more start a new row below). In a project: the head coach in the left column (centred on its
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

  // the team-wide Head Coach (one at most): in the middle of the Ground, the projects around it
  const teamHead = all.find((s) => s.role === 'head' && !s.projectId);
  const roots = [...projects.filter((p) => !p.parentId).map((p) => p.id), ...new Set(all.filter((s) => s.projectId && !known.has(s.projectId)).map((s) => s.projectId))];
  // each project laid out from (0, 0) first, then placed: around the Head Coach, or in rows of PROJECTS_PER_ROW
  const laid: { local: [Session, number, number][]; width: number; height: number; hasHead: boolean }[] = [];
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
    laid.push({ local, width, height, hasHead: !!head });
  }
  // a project left of the Head Coach: its Coach column goes to the right edge (the side facing the Head Coach), the
  // parts keep their left-to-right order
  const facing = (b: (typeof laid)[number], toTheLeft: boolean): [Session, number, number][] =>
    toTheLeft && b.hasHead
      ? b.local.map(([s2, lx, ly]): [Session, number, number] => (s2.role === 'head' ? [s2, b.width - H.w, ly] : [s2, lx - H.w - CORRIDOR, ly]))
      : b.local;
  if (teamHead) {
    // a k×k grid (k odd) with the Head Coach in the centre cell; projects fill the cells nearest to it first
    // (left, right, above, below, then the corners, then the next ring); each column/row as wide/tall as its largest
    let k = 3;
    while (k * k - 1 < laid.length) k += 2;
    const c = (k - 1) / 2;
    const cells: [number, number][] = [];
    for (let r = 0; r < k; r++) for (let q = 0; q < k; q++) if (r !== c || q !== c) cells.push([r, q]);
    const ring = ([r, q]: [number, number]): number => Math.max(Math.abs(r - c), Math.abs(q - c));
    const near = ([r, q]: [number, number]): number => Math.abs(r - c) + Math.abs(q - c);
    // within a ring: left and right before above and below (the Ground is wider than tall)
    const side = ([r, q]: [number, number]): number => (r === c ? 0 : q === c ? 1 : 2);
    cells.sort((a, b) => ring(a) - ring(b) || near(a) - near(b) || side(a) - side(b) || a[1] - b[1] || a[0] - b[0]);
    const T = CARD_TEAM_HEAD;
    if (k === 3) {
      // up to 8 projects: each one right against the Head Coach card (the middle one of each side centred on it), the
      // corners tucked in beside their neighbours - then everything shifted to start at (0, 0)
      const pos: { x: number; y: number; w: number; h: number }[] = [];
      // pushed past any block already placed that it would touch: outward (away from the Head Coach), or — for a block
      // straight above/below (or beside) it — sideways, away from that block, when that is the shorter way out (a tall
      // project on the left must not push the one above the Head Coach up past its whole height)
      const clear = (p: { x: number; y: number; w: number; h: number }, dx: number, dy: number, sideways = true): void => {
        let sx = 0; // a sideways direction, once taken, is kept (no bouncing between two neighbours)
        let sy = 0;
        for (let moved = true, n = 0; moved; n++) {
          if (n > 40) {
            if (sideways) {
              // could not settle sideways: start again, outward only
              p.x = start.x;
              p.y = start.y;
              clear(p, dx, dy, false);
            }
            return;
          }
          moved = false;
          for (const o of [...pos, { x: 0, y: 0, w: T.w, h: T.h }]) {
            const hit = p.x < o.x + o.w + GAP_RING && o.x < p.x + p.w + GAP_RING && p.y < o.y + o.h + GAP_RING && o.y < p.y + p.h + GAP_RING;
            if (!hit) continue;
            const isHead = o.x === 0 && o.y === 0 && o.w === T.w && o.h === T.h;
            const away = (pc: number, oc: number, locked: number): number => locked || (pc >= oc ? 1 : -1);
            const ax = dx !== 0 ? dx : sideways && !isHead ? away(p.x + p.w / 2, o.x + o.w / 2, sx) : 0;
            const ay = dy !== 0 ? dy : sideways && !isHead ? away(p.y + p.h / 2, o.y + o.h / 2, sy) : 0;
            // the shorter way out along the allowed directions
            const mx = ax < 0 ? o.x - GAP_RING - p.w - p.x : ax > 0 ? o.x + o.w + GAP_RING - p.x : Infinity;
            const my = ay < 0 ? o.y - GAP_RING - p.h - p.y : ay > 0 ? o.y + o.h + GAP_RING - p.y : Infinity;
            if (Math.abs(mx) <= Math.abs(my)) {
              p.x += mx;
              if (dx === 0) sx = ax;
            } else {
              p.y += my;
              if (dy === 0) sy = ay;
            }
            moved = true;
          }
        }
      };
      let start = { x: 0, y: 0 };
      laid.forEach((b, i) => {
        const [r, q] = cells[i]!;
        const dx = q - 1;
        const dy = r - 1;
        // start right against the Head Coach (centred on it along a side), then clear the blocks already there
        const p = {
          x: dx < 0 ? -GAP_RING - b.width : dx > 0 ? T.w + GAP_RING : (T.w - b.width) / 2,
          y: dy < 0 ? -GAP_RING - b.height : dy > 0 ? T.h + GAP_RING : (T.h - b.height) / 2,
          w: b.width,
          h: b.height
        };
        start = { x: p.x, y: p.y };
        clear(p, dx, dy);
        pos.push(p);
      });
      const all2 = [...pos, { x: 0, y: 0, w: T.w, h: T.h }];
      const dx = -Math.min(...all2.map((p) => p.x));
      const dy = -Math.min(...all2.map((p) => p.y));
      laid.forEach((b, i) => {
        const p = pos[i]!;
        for (const [s2, lx, ly] of facing(b, cells[i]![1] < 1)) place(s2, dx + p.x + lx, dy + p.y + ly);
      });
      place(teamHead, dx, dy);
      return out;
    }
    const colW = new Array<number>(k).fill(0);
    const rowH = new Array<number>(k).fill(0);
    colW[c] = T.w;
    rowH[c] = T.h;
    const at = laid.map((b, i) => {
      const [r, q] = cells[i]!;
      colW[q] = Math.max(colW[q]!, b.width);
      rowH[r] = Math.max(rowH[r]!, b.height);
      return [r, q] as const;
    });
    const colX: number[] = [];
    const rowY: number[] = [];
    for (let q = 0, x = 0; q < k; q++) {
      colX.push(x);
      if (colW[q]) x += colW[q]! + GAP_RING;
    }
    for (let r = 0, y = 0; r < k; r++) {
      rowY.push(y);
      if (rowH[r]) y += rowH[r]! + GAP_RING;
    }
    // each block pushed to the side of its cell that faces the Head Coach (centred on the middle column/row),
    // so every project sits as close to it as it can
    laid.forEach((b, i) => {
      const [r, q] = at[i]!;
      const ox = q < c ? colX[q]! + colW[q]! - b.width : q > c ? colX[q]! : colX[q]! + (colW[q]! - b.width) / 2;
      const oy = r < c ? rowY[r]! + rowH[r]! - b.height : r > c ? rowY[r]! : rowY[r]! + (rowH[r]! - b.height) / 2;
      for (const [s2, lx, ly] of facing(b, q < c)) place(s2, ox + lx, oy + ly);
    });
    place(teamHead, colX[c]! + (colW[c]! - T.w) / 2, rowY[c]! + (rowH[c]! - T.h) / 2);
    return out;
  }
  let col = 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of laid) {
    if (col === PROJECTS_PER_ROW) {
      col = 0;
      x = 0;
      y += rowH + GAP_PROJECT;
      rowH = 0;
    }
    for (const [s2, lx, ly] of b.local) place(s2, x + lx, y + ly);
    x += b.width + GAP_PROJECT;
    rowH = Math.max(rowH, b.height);
    col++;
  }
  return out;
}

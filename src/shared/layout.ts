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

/** spacing between the columns of projects */
const GAP_LANE = 260;
/** the shape the whole Ground is aimed at (width / height): a wide screen */
const TARGET_ASPECT = 1.7;

/**
 * One block per project, in the sidebar's order: its sessions in rows of CARDS_PER_ROW (the tree's order, then creation
 * time), so a small project is one short row and a big one grows downward. The blocks are then dealt into columns
 * ("lanes", each as wide as one block), every next project into the lane that is lowest so far, and the number of lanes
 * is the one that makes the whole Ground closest to a wide screen — projects sit side by side as well as one under another.
 * Sessions of an unknown project go last. Returns the new rectangle of every session.
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
  const blocks = [...ids, '']
    .map((key) => groups.get(key) ?? [])
    .filter((members) => members.length > 0)
    .map((members) => ({ members, rows: Math.ceil(members.length / CARDS_PER_ROW) }));
  const blockH = (rows: number): number => rows * (P.h + GAP_ROW) - GAP_ROW;
  const laneW = CARDS_PER_ROW * (P.w + GAP_X) - GAP_X;

  /** deal the blocks into `n` lanes: each into the lowest lane (the left one on a tie) */
  const deal = (n: number): { lane: number; y: number }[] => {
    const heights = Array<number>(n).fill(0);
    return blocks.map((b) => {
      const lane = heights.indexOf(Math.min(...heights));
      const y = heights[lane]!;
      heights[lane] = y + blockH(b.rows) + GAP_PROJECT;
      return { lane, y };
    });
  };
  const aspect = (n: number): number => {
    const used = new Set(deal(n).map((d) => d.lane)).size;
    const heights = Array<number>(n).fill(0);
    for (const [i, d] of deal(n).entries()) heights[d.lane] = Math.max(heights[d.lane]!, d.y + blockH(blocks[i]!.rows));
    return (used * laneW + (used - 1) * GAP_LANE) / Math.max(1, ...heights);
  };
  let lanes = 1;
  for (let n = 2; n <= Math.min(4, blocks.length); n++) if (Math.abs(aspect(n) - TARGET_ASPECT) < Math.abs(aspect(lanes) - TARGET_ASPECT)) lanes = n;

  deal(lanes).forEach((slot, i) => {
    const x0 = slot.lane * (laneW + GAP_LANE);
    blocks[i]!.members.forEach((s, k) => {
      out.set(s.id, { x: x0 + (k % CARDS_PER_ROW) * (P.w + GAP_X), y: slot.y + Math.floor(k / CARDS_PER_ROW) * (P.h + GAP_ROW), w: P.w, h: P.h });
    });
  });
  return out;
}

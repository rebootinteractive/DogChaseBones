import { DIR_VEC, DIRS, colOf, idx, inBounds, rowOf } from './cells';

/**
 * Free placement, for the editor only. The game slides a group cell by cell and
 * stops at the first obstacle; the editor picks a group up and drops it, so the
 * question is simply "does the whole group fit here" -- answered before the
 * drop so the UI can show it live.
 */
export interface PlacementBoard {
  cols: number;
  rows: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  /** cell -> group id */
  units: Map<number, string>;
}

export interface Placement {
  /** Target cell per source cell, same order; -1 where it would leave the grid. */
  targets: number[];
  /** In-bounds targets something else already holds -- these get painted red. */
  blocked: number[];
  /** True when any part of the group would fall off the grid. */
  offGrid: boolean;
  ok: boolean;
}

/**
 * Where would `cells` land if shifted by (dc, dr), and would that work?
 * Only the cells being moved count as vacated, so a group may slide over its
 * own footprint but never onto a separate lump that shares its colour.
 */
export function evaluatePlacement(
  board: PlacementBoard,
  cells: number[],
  dc: number,
  dr: number,
): Placement {
  const targets: number[] = [];
  const blocked: number[] = [];
  const own = new Set(cells);
  let offGrid = false;

  for (const cell of cells) {
    const c = colOf(board.cols, cell) + dc;
    const r = rowOf(board.cols, cell) + dr;

    if (!inBounds(board.cols, board.rows, c, r)) {
      targets.push(-1);
      offGrid = true;
      continue;
    }

    const target = idx(board.cols, c, r);
    targets.push(target);

    // Only the cells actually being moved count as vacated. Another lump that
    // happens to share this one's colour is a different group, so it blocks.
    const taken =
      board.dead.has(target) ||
      board.walls.has(target) ||
      board.bees.has(target) ||
      (board.units.has(target) && !own.has(target));

    if (taken) blocked.push(target);
  }

  return { targets, blocked, offGrid, ok: !offGrid && blocked.length === 0 };
}

/**
 * The connected run of same-id block cells containing `cell` -- one actual
 * group. Two lumps sharing an id but not touching come back separately.
 * Empty when there is no block there.
 */
export function componentAt(board: PlacementBoard, cell: number): number[] {
  const group = board.units.get(cell);
  if (group === undefined) return [];

  const seen = new Set<number>([cell]);
  const stack = [cell];
  while (stack.length) {
    const cur = stack.pop()!;
    const c = colOf(board.cols, cur);
    const r = rowOf(board.cols, cur);
    for (const d of DIRS) {
      const { dc, dr } = DIR_VEC[d];
      const nc = c + dc;
      const nr = r + dr;
      if (!inBounds(board.cols, board.rows, nc, nr)) continue;
      const n = idx(board.cols, nc, nr);
      if (seen.has(n) || board.units.get(n) !== group) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

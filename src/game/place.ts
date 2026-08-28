import { colOf, idx, inBounds, rowOf } from './cells';

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
  /** Cells holding a bone with no block under it -- these block a drop. */
  bones: Set<number>;
  /** Cells holding a dog standing on the board. */
  dogs: Set<number>;
  /** Cells a block group holds. Only membership is read, never the value. */
  units: ReadonlyMap<number, unknown>;
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
 * own footprint but never onto a different group.
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

    // Only the cells actually being moved count as vacated. Every other group
    // blocks, however it happens to be coloured.
    const taken =
      board.dead.has(target) ||
      board.walls.has(target) ||
      board.bees.has(target) ||
      board.bones.has(target) ||
      board.dogs.has(target) ||
      (board.units.has(target) && !own.has(target));

    if (taken) blocked.push(target);
  }

  return { targets, blocked, offGrid, ok: !offGrid && blocked.length === 0 };
}

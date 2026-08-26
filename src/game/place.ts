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
 * Cells the group is vacating do not count as obstacles -- a group may always
 * slide over its own footprint.
 */
export function evaluatePlacement(
  board: PlacementBoard,
  cells: number[],
  group: string,
  dc: number,
  dr: number,
): Placement {
  const targets: number[] = [];
  const blocked: number[] = [];
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

    const holder = board.units.get(target);
    const taken =
      board.dead.has(target) ||
      board.walls.has(target) ||
      board.bees.has(target) ||
      (holder !== undefined && holder !== group);

    if (taken) blocked.push(target);
  }

  return { targets, blocked, offGrid, ok: !offGrid && blocked.length === 0 };
}

/** Cells belonging to `group`, in ascending order so results are stable. */
export function cellsOfGroup(units: Map<number, string>, group: string): number[] {
  return [...units].filter(([, g]) => g === group).map(([cell]) => cell).sort((a, b) => a - b);
}

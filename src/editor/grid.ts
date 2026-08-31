import { colOf, connectedComponents, idx, rowOf } from '../game/cells';
import { MAX_DIM, MIN_DIM } from '../game/level';
import type { BoneStack } from '../game/level';
import type { Dir } from '../game/cells';
import type { Grid, Shape } from './shapes';

/**
 * Growing the board a side at a time, and copying what stands on it.
 *
 * Kept apart from EditorApp for the reason shapes.ts is: these are rules about
 * cells rather than pixels, and two features lean on them -- the grid pad,
 * which moves one edge at a time, and Undo, which remembers a whole board.
 *
 * Nothing here touches the level file. A resize is an edit to level *content*
 * in exactly the format the editor already writes.
 */

export interface EditorQueue { cell: number; dir: Dir; count: number }

/** Everything standing on the board. Not the tool, camera or selection. */
export interface GridContent {
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  dogs: Set<number>;
  bones: Map<number, BoneStack>;
  queues: EditorQueue[];
  shapes: Shape[];
}

/** A copy sharing nothing with the original -- what one undo step holds. */
export function cloneContent(c: GridContent): GridContent {
  return {
    dead: new Set(c.dead),
    walls: new Set(c.walls),
    bees: new Set(c.bees),
    dogs: new Set(c.dogs),
    bones: new Map([...c.bones].map(([cell, stack]) => [cell, { ...stack }])),
    queues: c.queues.map((q) => ({ ...q })),
    shapes: c.shapes.map((s) => ({ cells: new Set(s.cells) })),
  };
}

/**
 * Do two boards hold the same thing?
 *
 * Undo uses this to throw away a step that changed nothing -- a paint the
 * Block tool refused, a tap that only picked a queue. Selection and tool state
 * deliberately do not count: they are not what Ctrl+Z is for.
 */
export function sameContent(a: GridContent, b: GridContent): boolean {
  const sameCells = (x: Set<number>, y: Set<number>) =>
    x.size === y.size && [...x].every((v) => y.has(v));

  return sameCells(a.dead, b.dead)
    && sameCells(a.walls, b.walls)
    && sameCells(a.bees, b.bees)
    && sameCells(a.dogs, b.dogs)
    && a.bones.size === b.bones.size
    && [...a.bones].every(([cell, stack]) => {
      const other = b.bones.get(cell);
      return !!other && other.count === stack.count && other.order === stack.order;
    })
    && a.queues.length === b.queues.length
    && a.queues.every((q, i) => q.cell === b.queues[i].cell && q.dir === b.queues[i].dir && q.count === b.queues[i].count)
    && a.shapes.length === b.shapes.length
    && a.shapes.every((s, i) => sameCells(s.cells, b.shapes[i].cells));
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

/** A new grid size, plus how far its contents slide to stay where they were. */
export interface Resize { cols: number; rows: number; dc: number; dr: number }

/**
 * Add (`delta` 1) or take away (`delta` -1) one line of cells at `edge`.
 *
 * Which edge moves is the whole point. The right and bottom edges leave every
 * coordinate alone. The top and left ones push the contents the other way, so
 * that a row added above the board goes *above* what is already drawn instead
 * of shunting the level up into it.
 *
 * Null when the grid is already at its limit, so a caller can tell a refused
 * press from a real edit and leave the undo history alone.
 */
export function edgeResize(grid: Grid, edge: Edge, delta: number): Resize | null {
  const vertical = edge === 'top' || edge === 'bottom';
  const cols = vertical ? grid.cols : clampDim(grid.cols + delta);
  const rows = vertical ? clampDim(grid.rows + delta) : grid.rows;
  if (cols === grid.cols && rows === grid.rows) return null;
  return {
    cols,
    rows,
    dc: edge === 'left' ? cols - grid.cols : 0,
    dr: edge === 'top' ? rows - grid.rows : 0,
  };
}

/**
 * Move a board's contents onto the grid `to` describes.
 *
 * Anything that lands outside is dropped, and a block group cut in two by what
 * it lost comes out as two groups -- the same split the Block tool does, so a
 * broken shape behaves one way rather than two.
 */
export function resizeContent(from: Grid, to: Resize, content: GridContent): GridContent {
  /** Where `cell` ends up, or -1 when that is off the new grid. */
  const move = (cell: number): number => {
    const c = colOf(from.cols, cell) + to.dc;
    const r = rowOf(from.cols, cell) + to.dr;
    return c >= 0 && c < to.cols && r >= 0 && r < to.rows ? idx(to.cols, c, r) : -1;
  };

  const keep = (src: Iterable<number>): Set<number> => {
    const out = new Set<number>();
    for (const cell of src) {
      const next = move(cell);
      if (next >= 0) out.add(next);
    }
    return out;
  };

  const bones = new Map<number, BoneStack>();
  for (const [cell, stack] of content.bones) {
    const next = move(cell);
    if (next >= 0) bones.set(next, { ...stack });
  }

  const shapes: Shape[] = [];
  for (const shape of content.shapes) {
    // An empty slot is somewhere to paint, not a group that fell off the edge:
    // it survives. A group that lost every one of its cells does not.
    if (!shape.cells.size) { shapes.push({ cells: new Set() }); continue; }
    const kept = keep(shape.cells);
    if (!kept.size) continue;
    for (const part of connectedComponents(to.cols, to.rows, kept)) shapes.push({ cells: part });
  }

  return {
    dead: keep(content.dead),
    walls: keep(content.walls),
    bees: keep(content.bees),
    dogs: keep(content.dogs),
    bones,
    queues: content.queues
      .map((q) => ({ ...q, cell: move(q.cell) }))
      .filter((q) => q.cell >= 0),
    shapes,
  };
}

function clampDim(n: number): number {
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

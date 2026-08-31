import { describe, it, expect } from 'vitest';
import { cloneContent, edgeResize, resizeContent, sameContent } from '../src/editor/grid';
import type { GridContent } from '../src/editor/grid';
import { MAX_DIM, MIN_DIM } from '../src/game/level';

/**
 * Moving one edge of the board, without a canvas.
 *
 * The thing worth testing is that a level stays where the designer drew it.
 * Growing at the right or the bottom must leave every coordinate alone;
 * growing at the top or the left must carry the whole level along with the
 * edge, because the alternative is the level silently sliding into the new
 * row. Shrinking is the same rule read backwards, minus whatever was on the
 * edge that went.
 */

const empty = (): GridContent => ({
  dead: new Set(), walls: new Set(), bees: new Set(), dogs: new Set(),
  bones: new Map(), queues: [], shapes: [],
});

/** A 4x4 board with one wall, one bone and one two-cell shape, all at (1,1)-ish. */
const board = (): GridContent => ({
  ...empty(),
  walls: new Set([5]),                       // (1,1)
  bones: new Map([[6, { count: 2, order: 1 }]]),   // (2,1)
  dogs: new Set([9]),                        // (1,2)
  queues: [{ cell: 12, dir: 'left', count: 3 }],   // (0,3)
  shapes: [{ cells: new Set([13, 14]) }],    // (1,3) (2,3)
});

const grid4 = { cols: 4, rows: 4 };
const cellsOf = (s: { cells: Set<number> }) => [...s.cells].sort((a, b) => a - b);

describe('edgeResize', () => {
  it('leaves coordinates alone at the right and bottom edges', () => {
    expect(edgeResize(grid4, 'right', 1)).toEqual({ cols: 5, rows: 4, dc: 0, dr: 0 });
    expect(edgeResize(grid4, 'bottom', 1)).toEqual({ cols: 4, rows: 5, dc: 0, dr: 0 });
    expect(edgeResize(grid4, 'right', -1)).toEqual({ cols: 3, rows: 4, dc: 0, dr: 0 });
  });

  it('carries the contents along when the top or left edge moves', () => {
    expect(edgeResize(grid4, 'left', 1)).toEqual({ cols: 5, rows: 4, dc: 1, dr: 0 });
    expect(edgeResize(grid4, 'top', 1)).toEqual({ cols: 4, rows: 5, dc: 0, dr: 1 });
    expect(edgeResize(grid4, 'left', -1)).toEqual({ cols: 3, rows: 4, dc: -1, dr: 0 });
    expect(edgeResize(grid4, 'top', -1)).toEqual({ cols: 4, rows: 3, dc: 0, dr: -1 });
  });

  it('refuses to move an edge that is already at a limit', () => {
    expect(edgeResize({ cols: MIN_DIM, rows: 4 }, 'left', -1)).toBeNull();
    expect(edgeResize({ cols: MIN_DIM, rows: 4 }, 'right', -1)).toBeNull();
    expect(edgeResize({ cols: 4, rows: MAX_DIM }, 'top', 1)).toBeNull();
    expect(edgeResize({ cols: 4, rows: MAX_DIM }, 'bottom', 1)).toBeNull();
  });
});

describe('a row added at the bottom', () => {
  const to = edgeResize(grid4, 'bottom', 1)!;
  const next = resizeContent(grid4, to, board());

  it('keeps every cell where it was', () => {
    // Same (col,row), but the row is wider now, so the flat index is unchanged
    // only because cols did not change -- that is the case being pinned here.
    expect([...next.walls]).toEqual([5]);
    expect([...next.dogs]).toEqual([9]);
    expect(cellsOf(next.shapes[0])).toEqual([13, 14]);
    expect(next.queues).toEqual([{ cell: 12, dir: 'left', count: 3 }]);
  });
});

describe('a row added at the top', () => {
  const to = edgeResize(grid4, 'top', 1)!;
  const next = resizeContent(grid4, to, board());

  it('pushes everything down one row so the new row is empty', () => {
    expect([...next.walls]).toEqual([9]);            // (1,1) -> (1,2)
    expect([...next.dogs]).toEqual([13]);            // (1,2) -> (1,3)
    expect(cellsOf(next.shapes[0])).toEqual([17, 18]);   // row 3 -> row 4
    expect(next.queues).toEqual([{ cell: 16, dir: 'left', count: 3 }]);
    expect([...next.bones]).toEqual([[10, { count: 2, order: 1 }]]);
  });

  it('leaves the top row of the new board empty', () => {
    const occupied = [...next.walls, ...next.dogs, ...next.bones.keys(), ...next.shapes[0].cells];
    expect(occupied.every((cell) => cell >= to.cols)).toBe(true);
  });
});

describe('a column added on the left', () => {
  const to = edgeResize(grid4, 'left', 1)!;
  const next = resizeContent(grid4, to, board());

  it('shifts everything one column right', () => {
    // (1,1) on a 4-wide board is 5; (2,1) on a 5-wide board is 7.
    expect([...next.walls]).toEqual([7]);
    expect([...next.bones]).toEqual([[8, { count: 2, order: 1 }]]);
    expect(cellsOf(next.shapes[0])).toEqual([17, 18]);   // (1,3),(2,3) -> (2,3),(3,3)
  });
});

describe('taking an edge away', () => {
  it('drops what stood on the row that went, and shifts the rest back', () => {
    const to = edgeResize(grid4, 'top', -1)!;
    const next = resizeContent(grid4, to, { ...board(), dead: new Set([0, 1]) });
    expect([...next.dead]).toEqual([]);               // row 0 is gone with the edge
    expect([...next.walls]).toEqual([1]);             // (1,1) -> (1,0)
    expect(cellsOf(next.shapes[0])).toEqual([9, 10]); // (1,3),(2,3) -> (1,2),(2,2)
  });

  it('drops a queue whose entry cell went with the edge', () => {
    const to = edgeResize(grid4, 'left', -1)!;
    const next = resizeContent(grid4, to, board());   // queue sits in column 0
    expect(next.queues).toEqual([]);
  });

  it('splits a block group the lost column was holding together', () => {
    // A U of blocks: losing the right column takes the bridge with it.
    const content: GridContent = {
      ...empty(),
      shapes: [{ cells: new Set([2, 3, 7, 10, 11]) }],   // (2,0)(3,0)(3,1)(2,2)(3,2)
    };
    const to = edgeResize(grid4, 'right', -1)!;
    const next = resizeContent(grid4, to, content);
    expect(next.shapes.length).toBe(2);
    expect(next.shapes.map(cellsOf).sort()).toEqual([[2], [8]]);   // (2,0) and (2,2)
  });

  it('drops a group that lost every cell but keeps an empty slot to paint into', () => {
    const content: GridContent = {
      ...empty(),
      shapes: [{ cells: new Set([3]) }, { cells: new Set() }],   // (3,0), then a slot
    };
    const to = edgeResize(grid4, 'right', -1)!;
    const next = resizeContent(grid4, to, content);
    expect(next.shapes.map(cellsOf)).toEqual([[]]);
  });
});

describe('cloneContent', () => {
  it('shares nothing with the original', () => {
    const before = board();
    const copy = cloneContent(before);

    before.walls.add(0);
    before.bones.get(6)!.count = 9;
    before.shapes[0].cells.add(15);
    before.queues[0].count = 1;

    expect([...copy.walls]).toEqual([5]);
    expect(copy.bones.get(6)).toEqual({ count: 2, order: 1 });
    expect(cellsOf(copy.shapes[0])).toEqual([13, 14]);
    expect(copy.queues[0].count).toBe(3);
  });
});

describe('sameContent', () => {
  it('is true for a board and its copy', () => {
    const before = board();
    expect(sameContent(before, cloneContent(before))).toBe(true);
  });

  it('notices a cell, a bone stack, a queue and a shape', () => {
    const check = (edit: (c: GridContent) => void) => {
      const after = cloneContent(board());
      edit(after);
      return sameContent(board(), after);
    };
    expect(check((c) => c.walls.add(0))).toBe(false);
    expect(check((c) => c.walls.delete(5))).toBe(false);
    expect(check((c) => { c.bones.get(6)!.count = 3; })).toBe(false);
    expect(check((c) => { c.bones.get(6)!.order = 2; })).toBe(false);
    expect(check((c) => { c.queues[0].dir = 'up'; })).toBe(false);
    expect(check((c) => { c.queues.push({ cell: 3, dir: 'up', count: 1 }); })).toBe(false);
    expect(check((c) => c.shapes[0].cells.add(15))).toBe(false);
    expect(check((c) => { c.shapes.push({ cells: new Set() }); })).toBe(false);
  });

  it('does not confuse two boards that moved the same bone to different cells', () => {
    const a = cloneContent(board());
    const b = cloneContent(board());
    b.bones.delete(6);
    b.bones.set(7, { count: 2, order: 1 });
    expect(sameContent(a, b)).toBe(false);
  });
});

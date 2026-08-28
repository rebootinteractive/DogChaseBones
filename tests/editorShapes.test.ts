import { describe, it, expect } from 'vitest';
import { detachCell, dropShape, indexShapes, paintCell, touches } from '../src/editor/shapes';
import type { Shape } from '../src/editor/shapes';

/**
 * The Block tool's rules, without a canvas.
 *
 * The invariant under test is that a shape in the editor is always exactly one
 * connected piece -- the same thing that is true of a block group on the board.
 * An edit that would break a shape does not get refused; it *splits* it, which
 * is what the game itself does when a bone is eaten off a bridging block. One
 * rule, in both places.
 */

const grid = { cols: 4, rows: 4 };
const shape = (...cells: number[]): Shape => ({ cells: new Set(cells) });
const cellsOf = (s: Shape) => [...s.cells].sort((a, b) => a - b);

describe('touches', () => {
  it('is true for an orthogonal neighbour and false for a diagonal one', () => {
    const s = shape(5);
    expect(touches(grid, s, 4)).toBe(true);
    expect(touches(grid, s, 1)).toBe(true);
    expect(touches(grid, s, 0)).toBe(false);   // diagonal
  });

  it('does not wrap around a row edge', () => {
    // cell 3 is the end of row 0, cell 4 the start of row 1 -- adjacent as
    // indices, nowhere near each other on the board.
    expect(touches(grid, shape(3), 4)).toBe(false);
  });
});

describe('painting into the selected shape', () => {
  it('takes the first cell of an empty shape with nothing to touch', () => {
    const s = shape();
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 5)).toEqual({ kind: 'added', split: 1 });
    expect(list.owner.get(5)).toBe(s);
  });

  it('adds a cell that touches the shape', () => {
    const s = shape(5);
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 6)).toEqual({ kind: 'added', split: 1 });
    expect(cellsOf(s)).toEqual([5, 6]);
  });

  it('refuses a cell the shape does not touch', () => {
    const s = shape(5);
    const list = indexShapes([s]);
    const result = paintCell(list, grid, s, 15);
    expect(result.kind).toBe('refused');
    expect(list.owner.has(15)).toBe(false);
    expect(cellsOf(s)).toEqual([5]);
  });

  it('takes a cell back out when it is tapped again', () => {
    const s = shape(4, 5);
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 5)).toEqual({ kind: 'removed', split: 1 });
    expect(cellsOf(s)).toEqual([4]);
    expect(list.owner.has(5)).toBe(false);
  });

  it('drops the shape when its last cell goes', () => {
    const s = shape(5);
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 5)).toEqual({ kind: 'removed', split: 0 });
    expect(list.shapes).toEqual([]);
  });
});

describe('an edit that would leave a shape in two pieces splits it', () => {
  it('splits the selected shape when its bridge cell is erased', () => {
    const s = shape(4, 5, 6);
    const list = indexShapes([s]);

    expect(paintCell(list, grid, s, 5)).toEqual({ kind: 'removed', split: 2 });

    expect(list.shapes).toHaveLength(2);
    expect(list.shapes[0]).toBe(s);            // one part keeps the object
    expect(cellsOf(s)).toEqual([4]);
    expect(cellsOf(list.shapes[1])).toEqual([6]);
    expect(list.owner.get(6)).toBe(list.shapes[1]);
  });

  it('splits the donor when another shape steals its bridge', () => {
    const donor = shape(4, 5, 6);
    const thief = shape(1);                    // above cell 5, so it may take it
    const list = indexShapes([donor, thief]);

    expect(paintCell(list, grid, thief, 5)).toEqual({ kind: 'added', split: 2 });

    expect(cellsOf(thief)).toEqual([1, 5]);
    expect(list.owner.get(5)).toBe(thief);
    expect(list.shapes).toHaveLength(3);
    expect(cellsOf(donor)).toEqual([4]);
  });

  it('splits into three when a cross loses its centre', () => {
    const s = shape(1, 4, 5, 6, 9);
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 5)).toEqual({ kind: 'removed', split: 4 });
    expect(list.shapes).toHaveLength(4);
  });

  it('removes a donor that had only the one cell', () => {
    const donor = shape(5);
    const thief = shape(4);
    const list = indexShapes([donor, thief]);

    expect(paintCell(list, grid, thief, 5)).toEqual({ kind: 'added', split: 0 });

    expect(list.shapes).toEqual([thief]);
    expect(cellsOf(thief)).toEqual([4, 5]);
  });

  it('leaves a shape alone when what remains is still connected', () => {
    // An L: losing the tail keeps the other two touching.
    const s = shape(4, 5, 9);
    const list = indexShapes([s]);
    expect(paintCell(list, grid, s, 9)).toEqual({ kind: 'removed', split: 1 });
    expect(list.shapes).toEqual([s]);
    expect(cellsOf(s)).toEqual([4, 5]);
  });
});

describe('dropShape', () => {
  it('reports the cells it freed so riding bones can go with them', () => {
    const s = shape(4, 5);
    const other = shape(0);
    const list = indexShapes([s, other]);
    expect(dropShape(list, s).sort((a, b) => a - b)).toEqual([4, 5]);
    expect(list.shapes).toEqual([other]);
    expect(list.owner.has(4)).toBe(false);
    expect(list.owner.get(0)).toBe(other);
  });
});

describe('detachCell', () => {
  it('does nothing for a cell the shape does not hold', () => {
    const s = shape(4, 5);
    const list = indexShapes([s]);
    expect(detachCell(list, grid, s, 9)).toBe(1);
    expect(cellsOf(s)).toEqual([4, 5]);
  });
});

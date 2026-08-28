import { DIRS, DIR_VEC, colOf, connectedComponents, idx, inBounds, rowOf } from '../game/cells';

/**
 * Editing a list of block groups.
 *
 * Kept apart from EditorApp because this is where the rules live and EditorApp
 * is a Pixi application: the invariant that a shape is always one connected
 * piece is worth testing on its own, without a canvas.
 *
 * Same model as the board at runtime -- a shape is an object in a list, and a
 * derived cell index says which one holds a cell. Splitting is the same
 * operation too: keep one part, push the rest.
 */

export interface Shape { cells: Set<number> }

export interface ShapeList {
  shapes: Shape[];
  /** Derived from `shapes`. Every function here keeps it in step. */
  owner: Map<number, Shape>;
}

export interface Grid { cols: number; rows: number }

/** Build the cell index from a set of shapes. Derived, never patched by hand. */
export function indexShapes(shapes: Shape[]): ShapeList {
  const owner = new Map<number, Shape>();
  for (const shape of shapes) for (const cell of shape.cells) owner.set(cell, shape);
  return { shapes, owner };
}

/** Is `cell` orthogonally adjacent to anything the shape already holds? */
export function touches(grid: Grid, shape: Shape, cell: number): boolean {
  const c = colOf(grid.cols, cell);
  const r = rowOf(grid.cols, cell);
  return DIRS.some((d) => {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (!inBounds(grid.cols, grid.rows, nc, nr)) return false;
    return shape.cells.has(idx(grid.cols, nc, nr));
  });
}

/**
 * Take one cell out of a shape.
 *
 * An emptied shape is removed. A shape left in pieces *splits* rather than
 * being refused -- the same thing the game does when a bone is eaten off the
 * block holding a group together, so there is one rule to learn rather than
 * two. Returns how many pieces the shape ended up as: 0 if it is gone.
 */
export function detachCell(list: ShapeList, grid: Grid, shape: Shape, cell: number): number {
  if (!shape.cells.has(cell)) return shape.cells.size ? 1 : 0;

  shape.cells.delete(cell);
  list.owner.delete(cell);

  if (shape.cells.size === 0) {
    list.shapes = list.shapes.filter((s) => s !== shape);
    return 0;
  }

  const parts = connectedComponents(grid.cols, grid.rows, shape.cells);
  if (parts.length === 1) return 1;

  shape.cells = parts[0];
  for (const part of parts.slice(1)) {
    const extra: Shape = { cells: part };
    list.shapes.push(extra);
    for (const c of part) list.owner.set(c, extra);
  }
  return parts.length;
}

/** Remove a shape outright. Its cells are returned so the caller can tidy up. */
export function dropShape(list: ShapeList, shape: Shape): number[] {
  const cells = [...shape.cells];
  for (const cell of cells) list.owner.delete(cell);
  shape.cells.clear();
  list.shapes = list.shapes.filter((s) => s !== shape);
  return cells;
}

/**
 * What a tap with the Block tool did.
 *
 * `split` counts the pieces something broke into -- 1 when nothing split, so
 * anything above 1 is worth telling the designer about.
 */
export type Paint =
  | { kind: 'removed'; split: number }
  | { kind: 'added'; split: number }
  | { kind: 'refused'; reason: string };

/**
 * Tap `cell` while `shape` is selected.
 *
 * Three things can happen. A cell the shape already holds leaves it. A free
 * cell touching it joins it. A cell held by another shape moves across, and
 * that shape splits if it was the bridge. A cell the shape does not touch is
 * refused, because there is no way to add it and stay one piece.
 */
export function paintCell(list: ShapeList, grid: Grid, shape: Shape, cell: number): Paint {
  const holder = list.owner.get(cell);

  if (holder === shape) return { kind: 'removed', split: detachCell(list, grid, shape, cell) };

  // The first cell of an empty shape is the exception: there is nothing yet for
  // it to be connected to.
  if (shape.cells.size > 0 && !touches(grid, shape, cell)) {
    return { kind: 'refused', reason: 'A shape is one connected piece — paint next to it.' };
  }

  const split = holder ? detachCell(list, grid, holder, cell) : 1;
  shape.cells.add(cell);
  list.owner.set(cell, shape);
  return { kind: 'added', split };
}

import { describe, it, expect } from 'vitest';
import { evaluatePlacement } from '../src/game/place';
import type { PlacementBoard } from '../src/game/place';

/**
 * Same ASCII convention as the other suites, flattened to an editor board.
 * The letter is only a way of saying which cells belong to which shape here --
 * `units` maps a cell to whatever object owns it, and only membership is read.
 */
function board(rows: string[]): { board: PlacementBoard; cellsOf: (letter: string) => number[] } {
  const cols = rows[0].length;
  const owners = new Map<string, object>();
  const cells = new Map<string, number[]>();
  const b: PlacementBoard = {
    cols, rows: rows.length,
    dead: new Set(), walls: new Set(), bees: new Set(),
    bones: new Set(), dogs: new Set(), units: new Map<number, unknown>(),
  };
  const units = b.units as Map<number, unknown>;
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const cell = r * cols + c;
    if (ch === '#') b.walls.add(cell);
    else if (ch === 'X') b.dead.add(cell);
    else if (ch === '*') b.bees.add(cell);
    else if (ch === '+') b.bones.add(cell);
    else if (ch === '@') b.dogs.add(cell);
    else if (/[a-z]/.test(ch)) {
      let owner = owners.get(ch);
      if (!owner) { owner = {}; owners.set(ch, owner); cells.set(ch, []); }
      units.set(cell, owner);
      cells.get(ch)!.push(cell);
    }
  }));
  return { board: b, cellsOf: (letter) => cells.get(letter) ?? [] };
}

/** Shift every cell painted with `letter`. */
const move = (rows: string[], letter: string, dc: number, dr: number) => {
  const { board: b, cellsOf } = board(rows);
  return evaluatePlacement(b, cellsOf(letter), dc, dr);
};

describe('evaluatePlacement', () => {
  it('accepts a move into open cells', () => {
    const p = move(['aa..', '....'], 'a', 2, 0);
    expect(p.ok).toBe(true);
    expect(p.targets).toEqual([2, 3]);
    expect(p.blocked).toEqual([]);
  });

  it('accepts a move that overlaps the group own footprint', () => {
    const p = move(['aaa.', '....'], 'a', 1, 0);
    expect(p.ok).toBe(true);
    expect(p.targets).toEqual([1, 2, 3]);
  });

  it('rejects and flags the offending cells when another group is in the way', () => {
    const p = move(['aa.b', '....'], 'a', 2, 0);
    expect(p.ok).toBe(false);
    expect(p.blocked).toEqual([3]);
    expect(p.offGrid).toBe(false);
  });

  it('rejects walls, bees and dead cells, listing each one', () => {
    expect(move(['aa#.', '....'], 'a', 1, 0).blocked).toEqual([2]);
    expect(move(['aa*.', '....'], 'a', 1, 0).blocked).toEqual([2]);
    expect(move(['aaX.', '....'], 'a', 1, 0).blocked).toEqual([2]);
  });

  it('rejects a move that would leave the grid, and says so separately', () => {
    const p = move(['aa..', '....'], 'a', 3, 0);
    expect(p.ok).toBe(false);
    expect(p.offGrid).toBe(true);
    expect(p.targets).toEqual([3, -1]);
  });

  it('reports every blocker, not just the first', () => {
    const p = move(['aa..', '..##'], 'a', 2, 1);
    expect(p.blocked).toEqual([6, 7]);
  });

  it('treats a zero move as valid, so a click that does not drag is harmless', () => {
    expect(move(['aa.b', '....'], 'a', 0, 0).ok).toBe(true);
  });

  it('handles an L-shaped group', () => {
    const p = move(['aa..', 'a...'], 'a', 1, 0);
    expect(p.ok).toBe(true);
    expect(p.targets).toEqual([1, 2, 5]);
  });
});

describe('a shape lands as one piece or not at all', () => {
  it('reports every cell that will not fit', () => {
    const p = move(['aa..', '..b.'], 'a', 1, 1);
    expect(p.ok).toBe(false);
    expect(p.blocked).toEqual([6]);
  });
});

describe('grid bones and grid dogs block a drop', () => {
  it('refuses either, and allows the bare cell between them', () => {
    const { board: b } = board(['a.+@']);
    expect(evaluatePlacement(b, [0], 2, 0).ok).toBe(false);   // onto the grid bone
    expect(evaluatePlacement(b, [0], 3, 0).ok).toBe(false);   // onto the grid dog
    expect(evaluatePlacement(b, [0], 1, 0).ok).toBe(true);
  });
});

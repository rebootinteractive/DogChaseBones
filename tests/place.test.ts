import { describe, it, expect } from 'vitest';
import { componentAt, evaluatePlacement } from '../src/game/place';
import type { PlacementBoard } from '../src/game/place';

/** Same ASCII convention as the other suites, flattened to an editor board. */
function board(rows: string[]): PlacementBoard {
  const cols = rows[0].length;
  const b: PlacementBoard = {
    cols, rows: rows.length,
    dead: new Set(), walls: new Set(), bees: new Set(),
    bones: new Set(), dogs: new Set(), units: new Map(),
  };
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    const cell = r * cols + c;
    if (ch === '#') b.walls.add(cell);
    else if (ch === 'X') b.dead.add(cell);
    else if (ch === '*') b.bees.add(cell);
    else if (ch === '+') b.bones.add(cell);
    else if (ch === '@') b.dogs.add(cell);
    else if (/[a-z]/.test(ch)) b.units.set(cell, ch);
  }));
  return b;
}

/** Grab the lump containing the first cell of `group` and shift it. */
const move = (rows: string[], group: string, dc: number, dr: number) => {
  const b = board(rows);
  const start = [...b.units].find(([, g]) => g === group)?.[0] ?? -1;
  return evaluatePlacement(b, componentAt(b, start), dc, dr);
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

describe('componentAt', () => {
  it('returns the touching run, not everything sharing the colour', () => {
    const b = board(['aa.a', '....']);
    expect(componentAt(b, 0)).toEqual([0, 1]);
    expect(componentAt(b, 3)).toEqual([3]);
  });

  it('follows the lump around corners', () => {
    const b = board(['aa..', '.a..', '.aa.']);
    expect(componentAt(b, 0)).toEqual([0, 1, 5, 9, 10]);
  });

  it('stops at a different colour even when they touch', () => {
    const b = board(['aab.', '....']);
    expect(componentAt(b, 0)).toEqual([0, 1]);
    expect(componentAt(b, 2)).toEqual([2]);
  });

  it('is empty where there is no block', () => {
    expect(componentAt(board(['a...', '....']), 2)).toEqual([]);
    expect(componentAt(board(['a...', '....']), -1)).toEqual([]);
  });
});

describe('two lumps sharing one colour', () => {
  it('will not let one lump be dropped onto the other', () => {
    const p = move(['aa.a', '....'], 'a', 2, 0);
    expect(p.ok).toBe(false);
    expect(p.blocked).toEqual([3]);
  });

  it('lets a lump move somewhere the other one is not', () => {
    const p = move(['aa.a', '....'], 'a', 0, 1);
    expect(p.ok).toBe(true);
    expect(p.targets).toEqual([4, 5]);
  });
});

describe('grid bones and grid dogs block a drop', () => {
  it('refuses either, and allows the bare cell between them', () => {
    const b = board(['a.+@']);
    expect(evaluatePlacement(b, [0], 2, 0).ok).toBe(false);   // onto the grid bone
    expect(evaluatePlacement(b, [0], 3, 0).ok).toBe(false);   // onto the grid dog
    expect(evaluatePlacement(b, [0], 1, 0).ok).toBe(true);
  });
});

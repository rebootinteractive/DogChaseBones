import { describe, it, expect } from 'vitest';
import { canStepGroup, slideGroupBy, stepGroup } from '../src/game/slide';
import { boardFromAscii, groupAt, toAscii } from './helpers';

describe('canStepGroup', () => {
  it('lets a group move into open cells', () => {
    const b = boardFromAscii(['aa..', '....']);
    expect(canStepGroup(b, groupAt(b, 0), 1, 0)).toBe(true);
    expect(canStepGroup(b, groupAt(b, 0), 0, 1)).toBe(true);
  });

  it('refuses to leave the grid', () => {
    const b = boardFromAscii(['aa..', '....']);
    expect(canStepGroup(b, groupAt(b, 0), -1, 0)).toBe(false);
    expect(canStepGroup(b, groupAt(b, 0), 0, -1)).toBe(false);
  });

  it('refuses walls, bees, dead cells and other groups', () => {
    for (const rows of [['aa#.'], ['aa*.'], ['aaX.'], ['aab.']]) {
      const b = boardFromAscii(rows);
      expect(canStepGroup(b, groupAt(b, 0), 1, 0)).toBe(false);
    }
  });

  it('lets a group move through cells it is vacating itself', () => {
    // The whole 3-wide group shifts right into the cell its own tail leaves.
    const b = boardFromAscii(['aaa.']);
    expect(canStepGroup(b, groupAt(b, 0), 1, 0)).toBe(true);
  });

  it('refuses cells reserved by a walking dog', () => {
    const b = boardFromAscii(['aa..']);
    b.reserved.add(2);
    expect(canStepGroup(b, groupAt(b, 0), 1, 0)).toBe(false);
  });

  it('is false for a zero step and for a group with no cells', () => {
    const b = boardFromAscii(['aa..']);
    expect(canStepGroup(b, groupAt(b, 0), 0, 0)).toBe(false);
    expect(canStepGroup(b, { cells: new Set<number>() }, 1, 0)).toBe(false);
  });
});

describe('stepGroup', () => {
  it('moves every cell and keeps the group and the index in sync', () => {
    const b = boardFromAscii(['aA..', '....']);
    const g = groupAt(b, 0);
    expect(stepGroup(b, g, 1, 0)).toBe(true);
    expect(toAscii(b)).toEqual(['.aA.', '....']);
    expect([...g.cells].sort((x, y) => x - y)).toEqual([1, 2]);
    expect(b.unitAt.get(1)).toBe(g);
    expect(b.unitAt.has(0)).toBe(false);
  });

  it('carries bones with the group', () => {
    const b = boardFromAscii(['A...', '....']);
    stepGroup(b, groupAt(b, 0), 0, 1);
    expect(toAscii(b)).toEqual(['....', 'A...']);
    expect(b.bones.get(4)!.count).toBe(1);
  });

  it('changes nothing when blocked', () => {
    const b = boardFromAscii(['aa#.', '....']);
    expect(stepGroup(b, groupAt(b, 0), 1, 0)).toBe(false);
    expect(toAscii(b)).toEqual(['aa#.', '....']);
  });
});

describe('slideGroupBy', () => {
  it('travels the full requested distance when open', () => {
    const b = boardFromAscii(['a....', '#####']);
    expect(slideGroupBy(b, groupAt(b, 0), 4, 0)).toEqual({ dc: 4, dr: 0 });
    expect(toAscii(b)).toEqual(['....a', '#####']);
  });

  it('stops against the first obstacle', () => {
    const b = boardFromAscii(['a.#..', '#####']);
    expect(slideGroupBy(b, groupAt(b, 0), 4, 0)).toEqual({ dc: 1, dr: 0 });
    expect(toAscii(b)).toEqual(['.a#..', '#####']);
  });

  it('rounds a corner within a single drag', () => {
    const b = boardFromAscii([
      'a.#',
      '..#',
      '...',
    ]);
    // Wants right 2 / down 2; the wall column forces it down first, then right.
    expect(slideGroupBy(b, groupAt(b, 0), 2, 2)).toEqual({ dc: 2, dr: 2 });
    expect(toAscii(b)).toEqual(['..#', '..#', '..a']);
  });

  it('reports the partial offset when it gets stuck part way', () => {
    const b = boardFromAscii([
      'a#',
      '##',
    ]);
    expect(slideGroupBy(b, groupAt(b, 0), 1, 1)).toEqual({ dc: 0, dr: 0 });
  });
});

describe('grid bones block sliding', () => {
  it('stops a group dead', () => {
    const b = boardFromAscii(['a.+.', '....']);
    expect(canStepGroup(b, groupAt(b, 0), 1, 0)).toBe(true);
    expect(slideGroupBy(b, groupAt(b, 0), 3, 0)).toEqual({ dc: 1, dr: 0 });
  });

  it('is not dragged along by a group sliding past it', () => {
    const b = boardFromAscii(['a...', '.+..']);
    slideGroupBy(b, groupAt(b, 0), 3, 0);
    expect(b.bones.get(5)).toEqual({ count: 1, order: 1 });
    expect(b.unitAt.has(5)).toBe(false);
  });
});

describe('grid dogs block sliding', () => {
  it('stops a group dead', () => {
    const b = boardFromAscii(['a.@.', '....']);
    expect(slideGroupBy(b, groupAt(b, 0), 3, 0)).toEqual({ dc: 1, dr: 0 });
  });
});

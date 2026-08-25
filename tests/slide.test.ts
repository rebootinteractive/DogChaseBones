import { describe, it, expect } from 'vitest';
import { canStepGroup, slideGroupBy, stepGroup } from '../src/game/slide';
import { boardFromAscii, toAscii } from './helpers';

describe('canStepGroup', () => {
  it('lets a group move into open cells', () => {
    const b = boardFromAscii(['aa..', '....']);
    expect(canStepGroup(b, 'a', 1, 0)).toBe(true);
    expect(canStepGroup(b, 'a', 0, 1)).toBe(true);
  });

  it('refuses to leave the grid', () => {
    const b = boardFromAscii(['aa..', '....']);
    expect(canStepGroup(b, 'a', -1, 0)).toBe(false);
    expect(canStepGroup(b, 'a', 0, -1)).toBe(false);
  });

  it('refuses walls, bees, dead cells and other groups', () => {
    expect(canStepGroup(boardFromAscii(['aa#.']), 'a', 1, 0)).toBe(false);
    expect(canStepGroup(boardFromAscii(['aa*.']), 'a', 1, 0)).toBe(false);
    expect(canStepGroup(boardFromAscii(['aaX.']), 'a', 1, 0)).toBe(false);
    expect(canStepGroup(boardFromAscii(['aab.']), 'a', 1, 0)).toBe(false);
  });

  it('lets a group move through cells it is vacating itself', () => {
    // The whole 3-wide group shifts right into the cell its own tail leaves.
    const b = boardFromAscii(['aaa.']);
    expect(canStepGroup(b, 'a', 1, 0)).toBe(true);
  });

  it('refuses cells reserved by a walking dog', () => {
    const b = boardFromAscii(['aa..']);
    b.reserved.add(2);
    expect(canStepGroup(b, 'a', 1, 0)).toBe(false);
  });

  it('is false for a zero step and for an unknown group', () => {
    const b = boardFromAscii(['aa..']);
    expect(canStepGroup(b, 'a', 0, 0)).toBe(false);
    expect(canStepGroup(b, 'nope', 1, 0)).toBe(false);
  });
});

describe('stepGroup', () => {
  it('moves every unit and keeps the group set in sync', () => {
    const b = boardFromAscii(['aA..', '....']);
    expect(stepGroup(b, 'a', 1, 0)).toBe(true);
    expect(toAscii(b)).toEqual(['.aA.', '....']);
    expect([...b.groups.get('a')!].sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it('carries bones with the group', () => {
    const b = boardFromAscii(['A...', '....']);
    stepGroup(b, 'a', 0, 1);
    expect(toAscii(b)).toEqual(['....', 'A...']);
    expect(b.units.get(4)!.bone).toBe(true);
  });

  it('changes nothing when blocked', () => {
    const b = boardFromAscii(['aa#.', '....']);
    expect(stepGroup(b, 'a', 1, 0)).toBe(false);
    expect(toAscii(b)).toEqual(['aa#.', '....']);
  });
});

describe('slideGroupBy', () => {
  it('travels the full requested distance when open', () => {
    const b = boardFromAscii(['a....', '#####']);
    expect(slideGroupBy(b, 'a', 4, 0)).toEqual({ dc: 4, dr: 0 });
    expect(toAscii(b)).toEqual(['....a', '#####']);
  });

  it('stops against the first obstacle', () => {
    const b = boardFromAscii(['a.#..', '#####']);
    expect(slideGroupBy(b, 'a', 4, 0)).toEqual({ dc: 1, dr: 0 });
    expect(toAscii(b)).toEqual(['.a#..', '#####']);
  });

  it('rounds a corner within a single drag', () => {
    const b = boardFromAscii([
      'a.#',
      '..#',
      '...',
    ]);
    // Wants right 2 / down 2; the wall column forces it down first, then right.
    expect(slideGroupBy(b, 'a', 2, 2)).toEqual({ dc: 2, dr: 2 });
    expect(toAscii(b)).toEqual(['..#', '..#', '..a']);
  });

  it('reports the partial offset when it gets stuck part way', () => {
    const b = boardFromAscii([
      'a#',
      '##',
    ]);
    expect(slideGroupBy(b, 'a', 1, 1)).toEqual({ dc: 0, dr: 0 });
  });
});

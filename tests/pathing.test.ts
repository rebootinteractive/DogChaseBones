import { describe, it, expect } from 'vitest';
import { beeReach, findRoute } from '../src/game/pathing';
import { boardFromAscii } from './helpers';

describe('beeReach', () => {
  it('floods every open cell it can get to', () => {
    const b = boardFromAscii(['....', '.*..', '....']);
    expect(beeReach(b).size).toBe(11); // 12 cells minus the bee's own
  });

  it('is empty when the bee is walled in', () => {
    const b = boardFromAscii(['###', '#*#', '###']);
    expect(beeReach(b).size).toBe(0);
  });

  it('is stopped by blocks, walls and dead cells alike', () => {
    const b = boardFromAscii([
      '.A..',
      '####',
      '.*..',
    ]);
    const reach = beeReach(b);
    expect(reach.has(0)).toBe(false);   // top row is sealed off
    expect(reach.has(3)).toBe(false);
    expect(reach.has(8)).toBe(true);    // its own row is open
    expect(reach.has(11)).toBe(true);
  });

  it('cannot leave its island', () => {
    const b = boardFromAscii(['.A..', 'XXXX', '.*..']);
    const reach = beeReach(b);
    expect(reach.has(0)).toBe(false);
    expect(reach.has(2)).toBe(false);
    expect(reach.has(8)).toBe(true);
  });

  it('is stopped by a dog route already locked in', () => {
    const b = boardFromAscii(['....', '....']);
    b.bees.add(0);
    b.reserved.add(1);
    b.reserved.add(4);
    expect([...beeReach(b)].sort((x, y) => x - y)).toEqual([]);
  });
});

describe('findRoute', () => {
  const queue = (cell: number) => ({ id: 'q0', cell, dir: 'up' as const, remaining: 1 });

  it('walks open cells and stops beside the bone', () => {
    const b = boardFromAscii(['..A.', '####']);
    const route = findRoute(b, queue(0), new Set(), new Set());
    expect(route).toEqual({ path: [0, 1], boneCell: 2 });
  });

  it('refuses to go while a bee can reach the corridor', () => {
    const b = boardFromAscii(['..A.', '....', '.*..']);
    expect(findRoute(b, queue(0), beeReach(b), new Set())).toBeNull();
  });

  it('goes once the corridor is sealed off from the bee', () => {
    const b = boardFromAscii(['..A.', '####', '.*..']);
    const route = findRoute(b, queue(0), beeReach(b), new Set());
    expect(route).toEqual({ path: [0, 1], boneCell: 2 });
  });

  it('returns null when the entry cell is not open', () => {
    const b = boardFromAscii(['#.A.', '####']);
    expect(findRoute(b, queue(0), new Set(), new Set())).toBeNull();
  });

  it('returns null when no bone is reachable at all', () => {
    const b = boardFromAscii(['..#A', '..##']);
    expect(findRoute(b, queue(0), new Set(), new Set())).toBeNull();
  });

  it('takes a right-angle route around an obstacle', () => {
    const b = boardFromAscii([
      '.#A',
      '...',
      '###',
    ]);
    const route = findRoute(b, queue(0), new Set(), new Set());
    // down, right, right, then eat upward from (2,1)
    expect(route?.boneCell).toBe(2);
    expect(route?.path).toEqual([0, 3, 4, 5]);
  });

  it('skips a bone another dog has already claimed', () => {
    const b = boardFromAscii(['A..B', '....']);
    const near = findRoute(b, queue(4), new Set(), new Set());
    expect(near?.boneCell).toBe(0);

    const far = findRoute(b, queue(4), new Set(), new Set([0]));
    expect(far?.boneCell).toBe(3);
    // one of the two equally short routes; BFS scans up before right
    expect(far?.path).toEqual([4, 5, 1, 2]);
  });

  it('eats from the entry cell itself when the bone is already adjacent', () => {
    const b = boardFromAscii(['A...', '....']);
    const route = findRoute(b, queue(4), new Set(), new Set());
    expect(route).toEqual({ path: [4], boneCell: 0 });
  });
});

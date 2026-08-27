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
    const route = findRoute(b, queue(0), new Set(), new Map());
    expect(route).toEqual({ path: [0, 1], boneCell: 2 });
  });

  it('refuses to go while a bee can reach the corridor', () => {
    const b = boardFromAscii(['..A.', '....', '.*..']);
    expect(findRoute(b, queue(0), beeReach(b), new Map())).toBeNull();
  });

  it('goes once the corridor is sealed off from the bee', () => {
    const b = boardFromAscii(['..A.', '####', '.*..']);
    const route = findRoute(b, queue(0), beeReach(b), new Map());
    expect(route).toEqual({ path: [0, 1], boneCell: 2 });
  });

  it('returns null when the entry cell is not open', () => {
    const b = boardFromAscii(['#.A.', '####']);
    expect(findRoute(b, queue(0), new Set(), new Map())).toBeNull();
  });

  it('returns null when no bone is reachable at all', () => {
    const b = boardFromAscii(['..#A', '..##']);
    expect(findRoute(b, queue(0), new Set(), new Map())).toBeNull();
  });

  it('takes a right-angle route around an obstacle', () => {
    const b = boardFromAscii([
      '.#A',
      '...',
      '###',
    ]);
    const route = findRoute(b, queue(0), new Set(), new Map());
    // down, right, right, then eat upward from (2,1)
    expect(route?.boneCell).toBe(2);
    expect(route?.path).toEqual([0, 3, 4, 5]);
  });

  it('skips a bone another dog has already claimed', () => {
    const b = boardFromAscii(['A..B', '....']);
    const near = findRoute(b, queue(4), new Set(), new Map());
    expect(near?.boneCell).toBe(0);

    const far = findRoute(b, queue(4), new Set(), new Map([[0, 1]]));
    expect(far?.boneCell).toBe(3);
    // one of the two equally short routes; BFS scans up before right
    expect(far?.path).toEqual([4, 5, 1, 2]);
  });

  it('eats from the entry cell itself when the bone is already adjacent', () => {
    const b = boardFromAscii(['A...', '....']);
    const route = findRoute(b, queue(4), new Set(), new Map());
    expect(route).toEqual({ path: [4], boneCell: 0 });
  });
});

describe('eating straight off the queue', () => {
  const queue = (cell: number) => ({ id: 'q0', cell, dir: 'left' as const, remaining: 1 });

  it('takes a bone parked on the entry cell without stepping onto the board', () => {
    const b = boardFromAscii(['A...', '....']);
    expect(findRoute(b, queue(0), new Set(), new Map())).toEqual({ path: [], boneCell: 0 });
  });

  it('still refuses when the entry cell holds a block with no bone', () => {
    const b = boardFromAscii(['a...', '....']);
    expect(findRoute(b, queue(0), new Set(), new Map())).toBeNull();
  });

  it('goes even when a bee has poisoned the rest of the board', () => {
    const b = boardFromAscii(['A...', '....', '..*.']);
    expect(findRoute(b, queue(0), beeReach(b), new Map())).toEqual({ path: [], boneCell: 0 });
  });

  it('does not take a bone another dog has already claimed', () => {
    const b = boardFromAscii(['A...', '....']);
    expect(findRoute(b, queue(0), new Set(), new Map([[0, 1]]))).toBeNull();
  });

  it('still refuses when a wall sits on the entry cell', () => {
    const b = boardFromAscii(['#...', '....']);
    expect(findRoute(b, queue(0), new Set(), new Map())).toBeNull();
  });
});

describe('bone tiers', () => {
  const noClaims = new Map<number, number>();

  it('walks past a locked tier to reach the active one', () => {
    // Cell 1 (tier 2) sits right beside the entry; cell 5 (tier 1) is a step
    // further. The dog must ignore the near bone and take the far one.
    const b = boardFromAscii(['.A..', '.B..'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    b.bones.get(1)!.order = 2;
    expect(b.bones.get(5)!.order).toBe(1);
    const route = findRoute(b, b.queues[0], new Set(), noClaims)!;
    expect(route.boneCell).toBe(5);
    expect(route.path).toEqual([0, 4]);
  });

  it('unlocks the next tier once the lower one is gone', () => {
    // A tier is locked relative to what remains, not to the number 1: with only
    // tier 2 left on the board, tier 2 is the active tier.
    const b = boardFromAscii(['.A..', '.B..'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    b.bones.get(1)!.order = 2;
    b.bones.delete(5);
    b.units.delete(5);
    b.groups.delete('b');
    expect(findRoute(b, b.queues[0], new Set(), noClaims)!.boneCell).toBe(1);
  });

  it('reads tiers straight off an authored board', () => {
    const b = boardFromAscii(['aA..', '....'], [], ['.3..', '....']);
    expect(b.bones.get(1)!.order).toBe(3);
  });

  it('routes to a bone standing on the grid', () => {
    const b = boardFromAscii(['..+.', '####'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    const route = findRoute(b, b.queues[0], new Set(), noClaims)!;
    expect(route.boneCell).toBe(2);
    expect(route.path).toEqual([0, 1]);
  });
});

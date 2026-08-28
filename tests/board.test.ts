import { describe, it, expect } from 'vitest';
import { boundaryDirs, bonesRemaining, destroyCell, dogsRemaining, islands, takeBone, activeOrder, queuesOf, isBlocked } from '../src/game/board';
import { stepGroup } from '../src/game/slide';
import { boardFromAscii, specFromAscii, toAscii } from './helpers';

describe('destroyCell', () => {
  it('splits a group when the eaten block was the only thing holding it together', () => {
    // Driven through takeBone, the only caller of destroyCell in the game -- it
    // clears the bone first, so the vacated cell reads as empty rather than as
    // a bone with nothing under it.
    const b = boardFromAscii(['aAa', '...']);
    const { groups, destroyed } = takeBone(b, 1);
    expect(destroyed).toBe(true);
    expect(groups).toHaveLength(2);
    expect(b.groups).toHaveLength(2);
    // Different objects, so different groups. There is no id to compare.
    expect(b.unitAt.get(0)).not.toBe(b.unitAt.get(2));
    expect(toAscii(b)).toEqual(['a.b', '...']);
  });

  it('keeps the original object for one part, so a held reference stays live', () => {
    const b = boardFromAscii(['aAa', '...']);
    const held = b.unitAt.get(0)!;
    takeBone(b, 1);
    expect(b.groups).toContain(held);
    expect([...held.cells]).toEqual([0]);
  });

  it('leaves the group intact when the rest stays connected', () => {
    // L-shape: losing the corner-adjacent tail keeps the other two touching.
    const b = boardFromAscii(['aa.', 'A..']);
    const group = b.unitAt.get(0)!;
    expect(destroyCell(b, 3)).toEqual([group]);
    expect([...group.cells].sort((x, y) => x - y)).toEqual([0, 1]);
  });

  it('drops the group entirely when its last block is eaten', () => {
    const b = boardFromAscii(['A..', '...']);
    expect(destroyCell(b, 0)).toEqual([]);
    expect(b.groups).toHaveLength(0);
    expect(b.unitAt.size).toBe(0);
  });

  it('splits into three when a cross loses its centre', () => {
    const b = boardFromAscii(['.a.', 'aAa', '.#.']);
    expect(destroyCell(b, 4)).toHaveLength(3);
    expect(b.groups).toHaveLength(3);
  });

  it('does nothing for an empty cell', () => {
    const b = boardFromAscii(['...', '...']);
    expect(destroyCell(b, 0)).toEqual([]);
  });
});

describe('islands', () => {
  it('finds one island on a solid grid', () => {
    expect(islands(specFromAscii(['...', '...']))).toHaveLength(1);
  });

  it('finds two islands either side of a dead band', () => {
    const parts = islands(specFromAscii(['...', 'XXX', '...']));
    expect(parts).toHaveLength(2);
    expect(parts[0].size).toBe(3);
    expect(parts[1].size).toBe(3);
  });

  // A wall never moves, so a region fenced by walls is every bit as cut off as
  // one fenced by dead cells. Counting only dead cells here let a wall-sealed
  // pocket of dogs pass validation with no bones it could ever reach.
  it('finds two islands either side of a wall band', () => {
    const parts = islands(specFromAscii(['...', '###', '...']));
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.size)).toEqual([3, 3]);
  });

  it('counts a bee as a fence too', () => {
    expect(islands(specFromAscii(['.*.', '.*.']))).toHaveLength(2);
  });

  it('does not count blocks, which are there to be slid out of the way', () => {
    expect(islands(specFromAscii(['.a.', '.a.']))).toHaveLength(1);
  });
});

describe('boundaryDirs', () => {
  it('reports off-grid sides of a corner cell', () => {
    const spec = specFromAscii(['...', '...', '...']);
    expect(boundaryDirs(spec, 0).sort()).toEqual(['left', 'up']);
  });

  it('reports nothing for a cell locked inside the board', () => {
    const spec = specFromAscii(['...', '...', '...']);
    expect(boundaryDirs(spec, 4)).toEqual([]);
  });

  it('treats a dead neighbour as a boundary, so interior islands can have queues', () => {
    const spec = specFromAscii(['...', 'X..', '...']);
    expect(boundaryDirs(spec, 4)).toEqual(['left']);
  });
});

describe('dogsRemaining', () => {
  it('counts queued dogs plus dogs already on the board', () => {
    const b = boardFromAscii(['A..', '...'], [{ c: 0, r: 1, dir: 'down', count: 3 }]);
    expect(dogsRemaining(b)).toBe(3);
    queuesOf(b)[0].remaining--;
    b.walkers.push({ sourceId: 'q0', path: [3], step: 0, boneCell: 0 });
    expect(dogsRemaining(b)).toBe(3);
  });
});

describe('a group is one object, and the board is a list of them', () => {
  it('makes two shapes out of one letter painted in two places', () => {
    const b = boardFromAscii(['aa.a', '....']);
    expect(b.groups).toHaveLength(2);
    expect(b.unitAt.get(0)).toBe(b.unitAt.get(1));
    expect(b.unitAt.get(3)).not.toBe(b.unitAt.get(0));
  });

  it('is one group when the letter is already one piece', () => {
    expect(boardFromAscii(['aa..', '....']).groups).toHaveLength(1);
  });

  it('treats a letter touching only at a corner as two groups', () => {
    expect(boardFromAscii(['a...', '.a..']).groups).toHaveLength(2);
  });

  it('slides the two lumps independently', () => {
    const b = boardFromAscii(['aa.a', '....']);
    stepGroup(b, b.unitAt.get(0)!, 0, 1);
    expect(toAscii(b)).toEqual(['...b', 'aa..']);
  });

  it('keeps two different letters apart even when they touch', () => {
    const b = boardFromAscii(['aab.', '....']);
    expect(b.groups).toHaveLength(2);
    expect(b.unitAt.get(1)).not.toBe(b.unitAt.get(2));
  });

  it('makes them one group once the gap is painted in', () => {
    const joined = boardFromAscii(['aaaa', '....']);
    expect(joined.groups).toHaveLength(1);
    expect(joined.groups[0].cells.size).toBe(4);
  });

  it('carries bones with whichever lump owns them', () => {
    const b = boardFromAscii(['aA.A', '....']);
    stepGroup(b, b.unitAt.get(0)!, 0, 1);
    expect(b.bones.has(4)).toBe(false);
    expect(b.bones.get(5)).toEqual({ count: 1, order: 1 });
    expect(b.bones.get(3)).toEqual({ count: 1, order: 1 });   // the far lump did not move
  });
});

describe('the bone map', () => {
  it('holds every bone by cell, off the block', () => {
    const b = boardFromAscii(['aA..', '....']);
    expect(b.unitAt.get(1)).toBe(b.groups[0]);
    expect(b.bones.get(1)).toEqual({ count: 1, order: 1 });
    expect(b.bones.has(0)).toBe(false);
    expect(bonesRemaining(b)).toBe(1);
  });

  it('takeBone decrements a stack and leaves the block standing', () => {
    const b = boardFromAscii(['aA..', '....']);
    b.bones.set(1, { count: 3, order: 1 });
    expect(takeBone(b, 1)).toEqual({ bonesLeft: 2, destroyed: false, groups: [b.groups[0]] });
    expect(b.unitAt.has(1)).toBe(true);
  });

  it('takeBone removes the host block with the last bone', () => {
    // A lone block: taking its only bone drops its group entirely, not just re-splits it.
    const b = boardFromAscii(['A..', '...']);
    expect(takeBone(b, 0)).toEqual({ bonesLeft: 0, destroyed: true, groups: [] });
    expect(b.unitAt.has(0)).toBe(false);
    expect(b.bones.has(0)).toBe(false);
  });

  it('takeBone reports the groups a split left behind', () => {
    // a bridge block at cell 1 holding two lumps together
    const b = boardFromAscii(['aAa.', '....']);
    const out = takeBone(b, 1);
    expect(out.destroyed).toBe(true);
    expect(out.groups).toHaveLength(2);
  });

  it('takeBone on a bone with no block under it just clears the cell', () => {
    const b = boardFromAscii(['....', '....']);
    b.bones.set(1, { count: 1, order: 1 });
    expect(takeBone(b, 1)).toEqual({ bonesLeft: 0, destroyed: false, groups: [] });
    expect(b.bones.has(1)).toBe(false);
  });
});

describe('activeOrder', () => {
  it('is the lowest tier still on the board', () => {
    const b = boardFromAscii(['aA.B', '....']);
    b.bones.get(1)!.order = 2;
    b.bones.get(3)!.order = 5;
    expect(activeOrder(b)).toBe(2);
  });

  it('is null when every bone is gone', () => {
    const b = boardFromAscii(['a...', '....']);
    expect(activeOrder(b)).toBe(null);
  });
});

describe('dog sources', () => {
  it('puts a grid dog in sources and indexes its cell', () => {
    const b = boardFromAscii(['.@.+', '....']);
    expect(b.sources).toEqual([{ kind: 'grid', id: 'd0', cell: 1 }]);
    expect(b.gridDogs.has(1)).toBe(true);
    expect(dogsRemaining(b)).toBe(1);
  });

  it('blocks its cell', () => {
    const b = boardFromAscii(['a@..', '....']);
    expect(isBlocked(b, 1)).toBe(true);
  });
});

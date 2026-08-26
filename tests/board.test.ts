import { describe, it, expect } from 'vitest';
import { boundaryDirs, dogsRemaining, islands, removeUnit } from '../src/game/board';
import { stepGroup } from '../src/game/slide';
import { boardFromAscii, specFromAscii, toAscii } from './helpers';

describe('removeUnit', () => {
  it('splits a group when the eaten unit was the only thing holding it together', () => {
    const b = boardFromAscii(['aAa', '...']);
    const groups = removeUnit(b, 1);
    expect(groups).toHaveLength(2);
    expect(b.groups.has('a')).toBe(false);
    expect(b.units.get(0)!.group).not.toBe(b.units.get(2)!.group);
    expect(toAscii(b)).toEqual(['a.a', '...']);
  });

  it('leaves the group intact when the rest stays connected', () => {
    // L-shape: losing the corner-adjacent tail keeps the other two touching.
    const b = boardFromAscii(['aa.', 'A..']);
    expect(removeUnit(b, 3)).toEqual(['a']);
    expect([...b.groups.get('a')!].sort((x, y) => x - y)).toEqual([0, 1]);
  });

  it('drops the group entirely when its last unit is eaten', () => {
    const b = boardFromAscii(['A..', '...']);
    expect(removeUnit(b, 0)).toEqual([]);
    expect(b.groups.has('a')).toBe(false);
    expect(b.units.size).toBe(0);
  });

  it('splits into three when a cross loses its centre', () => {
    const b = boardFromAscii(['.a.', 'aAa', '.#.']);
    const groups = removeUnit(b, 4);
    expect(groups).toHaveLength(3);
  });

  it('does nothing for an empty cell', () => {
    const b = boardFromAscii(['...', '...']);
    expect(removeUnit(b, 0)).toEqual([]);
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
    b.queues[0].remaining--;
    b.walkers.push({ queueId: 'q0', path: [3], step: 0, boneCell: 0 });
    expect(dogsRemaining(b)).toBe(3);
  });
});

describe('a group is a connected run within an authored id', () => {
  it('splits one painted colour into separate groups where it is not touching', () => {
    const b = boardFromAscii(['aa.a', '....']);
    expect(b.groups.size).toBe(2);
    expect(b.groups.has('a')).toBe(false);
    expect(b.units.get(0)!.group).toBe(b.units.get(1)!.group);
    expect(b.units.get(3)!.group).not.toBe(b.units.get(0)!.group);
  });

  it('keeps the authored id when the colour is already one piece', () => {
    const b = boardFromAscii(['aa..', '....']);
    expect([...b.groups.keys()]).toEqual(['a']);
  });

  it('treats a colour touching only at a corner as two groups', () => {
    const b = boardFromAscii(['a...', '.a..']);
    expect(b.groups.size).toBe(2);
  });

  it('slides the two lumps independently', () => {
    const b = boardFromAscii(['aa.a', '....']);
    const left = b.units.get(0)!.group;
    stepGroup(b, left, 0, 1);
    expect(toAscii(b)).toEqual(['...a', 'aa..']);
  });

  it('keeps two different colours apart even when they touch', () => {
    const b = boardFromAscii(['aab.', '....']);
    expect(b.groups.size).toBe(2);
    expect(b.units.get(1)!.group).not.toBe(b.units.get(2)!.group);
  });

  it('makes them one group once the gap is painted in', () => {
    const joined = boardFromAscii(['aaaa', '....']);
    expect(joined.groups.size).toBe(1);
    expect([...joined.groups.values()][0].size).toBe(4);
  });

  it('carries bones with whichever lump owns them', () => {
    const b = boardFromAscii(['aA.A', '....']);
    const left = b.units.get(0)!.group;
    stepGroup(b, left, 0, 1);
    expect(b.units.get(4)!.bones).toBe(0);
    expect(b.units.get(5)!.bones).toBe(1);
    expect(b.units.get(3)!.bones).toBe(1);   // the far lump did not move
  });
});

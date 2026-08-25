import { describe, it, expect } from 'vitest';
import { boundaryDirs, dogsRemaining, islands, removeUnit } from '../src/game/board';
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

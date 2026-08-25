import { describe, it, expect } from 'vitest';
import { validateLevel } from '../src/game/validate';
import { specFromAscii } from './helpers';

const warns = (rows: string[], queues: Parameters<typeof specFromAscii>[1] = []) =>
  validateLevel(specFromAscii(rows, queues)).join(' | ');

describe('validateLevel', () => {
  it('passes a well-formed level', () => {
    expect(warns(['A...', '....'], [{ c: 0, r: 1, dir: 'down', count: 1 }])).toBe('');
  });

  it('flags a level with no queues and no bones', () => {
    const out = warns(['....', '....']);
    expect(out).toMatch(/No dog queues/);
    expect(out).toMatch(/No bones/);
  });

  it('flags more dogs than bones', () => {
    expect(warns(['A...', '....'], [{ c: 0, r: 1, dir: 'down', count: 3 }])).toMatch(/3 dogs but only 1 bones/);
  });

  it('flags a queue whose entry cell is a wall', () => {
    expect(warns(['A...', '#...'], [{ c: 0, r: 1, dir: 'down', count: 1 }])).toMatch(/entry cell is a wall/);
  });

  it('flags a queue facing into the board', () => {
    expect(warns(['A...', '....'], [{ c: 1, r: 1, dir: 'up', count: 1 }])).toMatch(/faces up, which is inside the board/);
  });

  it('flags two queues sharing a cell', () => {
    expect(warns(['A...', '....'], [
      { c: 0, r: 1, dir: 'down', count: 1 },
      { c: 0, r: 1, dir: 'left', count: 1 },
    ])).toMatch(/Two queues share the entry cell/);
  });

  it('flags an island whose dogs have no bones to eat', () => {
    const out = warns(['A...', 'XXXX', '....'], [{ c: 0, r: 2, dir: 'down', count: 1 }]);
    expect(out).toMatch(/Island 2: 1 dogs and no bones/);
  });

  it('does not complain about an island with no dogs at all', () => {
    const out = warns(['A...', 'XXXX', 'B...'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    expect(out).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { mergeLevels } from '../src/levels/merge';
import type { LevelData } from '../src/shared/types';

const L = (id: string, name: string): LevelData => ({ id, name, prototype: 'p', elements: [] });

describe('mergeLevels', () => {
  it('keeps builtin order first, remote sorted by name after', () => {
    const out = mergeLevels([L('b1', 'B1'), L('b2', 'B2')], [L('r2', 'Zebra'), L('r1', 'Apple')]);
    expect(out.map((l) => l.id)).toEqual(['b1', 'b2', 'r1', 'r2']);
  });
  it('a remote with a builtin id replaces it in place', () => {
    const out = mergeLevels([L('b1', 'B1'), L('b2', 'B2')], [{ ...L('b1', 'Edited'), elements: [{ type: 't', x: 0.5, y: 0.5 }] }]);
    expect(out.map((l) => l.id)).toEqual(['b1', 'b2']);
    expect(out[0].name).toBe('Edited');
    expect(out[0].elements).toHaveLength(1);
  });
  it('does not mutate the inputs', () => {
    const builtin = [L('b1', 'B1')];
    mergeLevels(builtin, [L('r1', 'A')]);
    expect(builtin).toHaveLength(1);
  });
});

import { describe, it, expect } from 'vitest';
import { validateLevelData } from '../src/levels/serialize';
import { SCHEMA_VERSION, countBones, countDogs, parseLevel } from '../src/game/level';
import { createBoard, bonesRemaining } from '../src/game/board';
import { PROTOTYPE } from '../src/config';
import type { LevelData } from '../src/shared/types';

const modules = import.meta.glob<{ default: unknown }>('../src/levels/published/*.json', { eager: true });
const entries = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => [path.split('/').pop()!, mod.default] as const);

/**
 * Level files committed under src/levels/published are written by the editor's
 * Repo tab and reviewed in git, so nothing else checks them. These are the
 * invariants that decide whether a file loads at all -- not whether the level
 * is any good, which is the designer's call and only raises soft warnings.
 */
describe.runIf(entries.length > 0)('committed level files', () => {
  it.each(entries)('%s loads', (_file, raw) => {
    expect(validateLevelData(raw)).toBe(true);

    const level = raw as LevelData;
    expect(level.prototype).toBe(PROTOTYPE);

    const meta = level.meta as Record<string, unknown> | undefined;
    expect(meta?.schema).toBe(SCHEMA_VERSION);

    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(countDogs(spec)).toBeGreaterThan(0);
    expect(bonesRemaining(createBoard(spec))).toBe(countBones(spec));
  });

  it('have ids that do not collide', () => {
    // Two files sharing an id would be one level with two faces: the Repo tab
    // would list both, and publishing either would overwrite the other.
    const ids = entries.map(([, raw]) => (raw as LevelData).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

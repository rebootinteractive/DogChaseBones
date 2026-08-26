import { describe, it, expect } from 'vitest';
import { PUBLISHED_LEVELS } from '../src/levels/published';
import { BUILTIN_LEVELS } from '../src/levels/builtin';
import { mergeLevels } from '../src/levels/merge';
import { validateLevelData } from '../src/levels/serialize';
import { countBones, countDogs, parseLevel } from '../src/game/level';
import { createBoard, bonesRemaining } from '../src/game/board';
import { PROTOTYPE } from '../src/config';
import type { LevelData } from '../src/shared/types';

// Same glob the app loads them through, so this covers the real path.
const modules = import.meta.glob<{ default: unknown }>('../src/levels/published/*.json', { eager: true });
const entries = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => [path.split('/').pop()!, mod.default] as const);

/**
 * Levels published from the editor and committed to the repo are
 * designer-authored, so nothing else checks them. These are the invariants that
 * decide whether a file loads at all -- not whether the level is any good,
 * which is the designer's call and only ever raises non-blocking warnings.
 */
describe.runIf(entries.length > 0)('published levels', () => {
  it.each(entries)('%s loads', (_file, raw) => {
    expect(validateLevelData(raw)).toBe(true);

    const level = raw as LevelData;
    expect(level.prototype).toBe(PROTOTYPE);

    // The local backend stamps this on at read time; committing it would badge
    // the level a draft for everyone, forever.
    const meta = level.meta as Record<string, unknown> | undefined;
    expect(meta?.draft).toBeUndefined();

    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(countDogs(spec)).toBeGreaterThan(0);
    expect(bonesRemaining(createBoard(spec))).toBe(countBones(spec));
  });

  it('are all picked up by the glob the app uses', () => {
    expect(PUBLISHED_LEVELS).toHaveLength(entries.length);
  });

  it('do not collide with each other', () => {
    // Two published levels sharing an id is a silent loss -- one would replace
    // the other. Sharing a *builtin* id is fine and deliberate: that is how an
    // edited baseline supersedes the original.
    const ids = PUBLISHED_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('supersede a builtin they share an id with, rather than doubling it', () => {
    const shown = mergeLevels(BUILTIN_LEVELS, PUBLISHED_LEVELS);
    expect(new Set(shown.map((l) => l.id)).size).toBe(shown.length);
    for (const published of PUBLISHED_LEVELS) {
      expect(shown.filter((l) => l.id === published.id)).toEqual([published]);
    }
  });
});

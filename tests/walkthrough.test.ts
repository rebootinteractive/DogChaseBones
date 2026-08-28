import { describe, it, expect } from 'vitest';
import { FIXTURE_LEVELS } from './fixtures/levels';
import { SCHEMA_VERSION, countBones, countDogs, parseLevel } from '../src/game/level';
import { createBoard, queuesOf, bonesRemaining, dogsRemaining } from '../src/game/board';
import type { BoardState } from '../src/game/board';
import { validateLevel } from '../src/game/validate';
import { finishWalker, isWon, resolveMoves } from '../src/game/resolve';
import { slideGroupBy } from '../src/game/slide';
import { idx } from '../src/game/cells';
import { groupAt } from './helpers';
import type { LevelData } from '../src/shared/types';

/** Headless play: send every dog that can go, land it instantly, repeat. */
function playOut(state: BoardState): number {
  let eaten = 0;
  for (let guard = 0; guard < 200; guard++) {
    resolveMoves(state);
    if (state.walkers.length === 0) return eaten;
    for (const w of [...state.walkers]) { finishWalker(state, w); eaten++; }
  }
  throw new Error('playOut never settled');
}

function boardFor(id: string) {
  const level = FIXTURE_LEVELS.find((l) => l.id === id)!;
  const { spec, issues } = parseLevel(level);
  expect(issues).toEqual([]);
  return { level, spec, state: createBoard(spec) };
}

describe('every fixture level', () => {
  it.each(FIXTURE_LEVELS.map((l) => [l.id, l] as const))('%s is structurally sound', (_id, level) => {
    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(validateLevel(spec)).toEqual([]);
    expect(countDogs(spec)).toBe(countBones(spec));
    expect(spec.schema).toBe(SCHEMA_VERSION);
  });
});

describe('1 - First Bone', () => {
  it('needs the block group moved off the entry cell, then solves itself', () => {
    const { spec, state } = boardFor('b1-first-bone');

    // The dog cannot even step on: its entry cell is under the block group.
    expect(playOut(state)).toBe(0);
    expect(isWon(state)).toBe(false);

    // The group is addressed by a cell it holds: (0,1), its top-left.
    expect(slideGroupBy(state, groupAt(state, idx(spec.cols, 0, 1)), 1, 0)).toEqual({ dc: 1, dr: 0 });
    expect(playOut(state)).toBe(1);
    expect(isWon(state)).toBe(true);
    expect(spec.timeLimit).toBe(90);
  });
});

describe('2 - Tight Squeeze', () => {
  it('walls the middle bone in until its group is slid clear', () => {
    const { spec, state } = boardFor('b2-tight-squeeze');
    const cell = (c: number, r: number) => idx(spec.cols, c, r);

    // The two loose bones go first; the walled-in one is unreachable.
    expect(playOut(state)).toBe(2);
    expect(isWon(state)).toBe(false);
    expect(state.bones.get(cell(2, 4))!.count).toBe(1);

    expect(slideGroupBy(state, groupAt(state, cell(1, 4)), 1, 0)).toEqual({ dc: 1, dr: 0 });
    expect(playOut(state)).toBe(1);
    expect(isWon(state)).toBe(true);
  });

  it('splits the bone group in two when its middle block is eaten', () => {
    const { spec, state } = boardFor('b2-tight-squeeze');
    const cell = (c: number, r: number) => idx(spec.cols, c, r);

    playOut(state);
    slideGroupBy(state, groupAt(state, cell(1, 4)), 1, 0);
    playOut(state);

    // Two objects where there was one -- there is no id to have been renamed.
    expect(groupAt(state, cell(2, 4))).not.toBe(groupAt(state, cell(4, 4)));
  });
});

describe('3 - Sealed Room', () => {
  it('holds both dogs until the gap in the wall is plugged', () => {
    const { spec, state } = boardFor('b3-sealed-room');
    const cell = (c: number, r: number) => idx(spec.cols, c, r);

    // The bee floods up through the gap, so the whole top room is off limits.
    expect(playOut(state)).toBe(0);
    expect(queuesOf(state)[0].remaining).toBe(2);

    expect(slideGroupBy(state, groupAt(state, cell(4, 1)), -1, 0)).toEqual({ dc: -1, dr: 0 });
    expect(state.unitAt.has(cell(3, 1))).toBe(true);

    expect(playOut(state)).toBe(2);
    expect(isWon(state)).toBe(true);
  });

  it('goes back to refusing if the plug is pulled out again', () => {
    const { spec, state } = boardFor('b3-sealed-room');
    const plug = groupAt(state, idx(spec.cols, 4, 1));
    slideGroupBy(state, plug, -1, 0);
    slideGroupBy(state, plug, 1, 0);
    expect(playOut(state)).toBe(0);
  });
});

/**
 * A level shaped exactly as the editor's `snapshot()` emits one: every new
 * element type, explicit `order` on every bone, schema 2. The editor itself
 * needs a DOM and Pixi, so this is what stands in for it -- it checks the
 * contract between what the editor writes and what the game reads.
 */
describe('an edition-2 level with all the new pieces', () => {
  const level: LevelData = {
    id: 'e2e-schema-2',
    name: 'Grid Pieces',
    prototype: 'dog-chase-bones',
    elements: [
      { type: 'wall', x: 3, y: 1 },
      { type: 'block', x: 1, y: 0, group: 'g1' },
      { type: 'bone', x: 1, y: 0, count: 2, order: 3 },
      { type: 'gridBone', x: 3, y: 2, count: 1, order: 2 },
      { type: 'gridBone', x: 0, y: 2, count: 1, order: 1 },
      { type: 'gridDog', x: 0, y: 1 },
      { type: 'queue', x: 3, y: 0, dir: 'up', count: 3 },
    ],
    meta: { schema: 2, cols: 4, rows: 3, timeLimit: 120 },
  };

  it('parses clean, with four dogs and four bones', () => {
    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(spec.schema).toBe(2);
    expect(countBones(spec)).toBe(4);
    expect(countDogs(spec)).toBe(4);
    expect(validateLevel(spec)).toEqual([]);
  });

  it('plays through to a win, tier by tier', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);

    // The tier-3 bone sits two cells from the queue and stays untouched while
    // tiers 1 and 2 are still on the board.
    const first = resolveMoves(state);
    expect(first.length).toBeGreaterThan(0);
    // Tier 1 is the grid bone at (0,2), nowhere near the queue -- and the grid
    // dog at (0,1) is right beside it, so it eats where it stands.
    expect(first.map((c) => c.boneCell)).toContain(idx(4, 0, 2));
    expect(first.every((c) => c.boneCell !== idx(4, 1, 0))).toBe(true);
    for (const w of [...state.walkers]) finishWalker(state, w);
    expect(state.bones.get(idx(4, 1, 0))!.count).toBe(2);

    playOut(state);
    expect(isWon(state)).toBe(true);
    expect(bonesRemaining(state)).toBe(0);
    expect(dogsRemaining(state)).toBe(0);
  });
});

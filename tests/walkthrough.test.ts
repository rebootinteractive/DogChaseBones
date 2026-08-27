import { describe, it, expect } from 'vitest';
import { FIXTURE_LEVELS } from './fixtures/levels';
import { SCHEMA_VERSION, countBones, countDogs, parseLevel } from '../src/game/level';
import { createBoard } from '../src/game/board';
import type { BoardState } from '../src/game/board';
import { validateLevel } from '../src/game/validate';
import { finishWalker, isWon, resolveMoves } from '../src/game/resolve';
import { slideGroupBy } from '../src/game/slide';
import { idx } from '../src/game/cells';

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

    expect(slideGroupBy(state, 'a', 1, 0)).toEqual({ dc: 1, dr: 0 });
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

    expect(slideGroupBy(state, 'b', 1, 0)).toEqual({ dc: 1, dr: 0 });
    expect(playOut(state)).toBe(1);
    expect(isWon(state)).toBe(true);
  });

  it('splits the bone group in two when its middle unit is eaten', () => {
    const { spec, state } = boardFor('b2-tight-squeeze');
    const cell = (c: number, r: number) => idx(spec.cols, c, r);

    playOut(state);
    slideGroupBy(state, 'b', 1, 0);
    playOut(state);

    expect(state.groups.has('b')).toBe(false);
    expect(state.units.get(cell(2, 4))!.group).not.toBe(state.units.get(cell(4, 4))!.group);
  });
});

describe('3 - Sealed Room', () => {
  it('holds both dogs until the gap in the wall is plugged', () => {
    const { spec, state } = boardFor('b3-sealed-room');
    const cell = (c: number, r: number) => idx(spec.cols, c, r);

    // The bee floods up through the gap, so the whole top room is off limits.
    expect(playOut(state)).toBe(0);
    expect(state.queues[0].remaining).toBe(2);

    expect(slideGroupBy(state, 'p', -1, 0)).toEqual({ dc: -1, dr: 0 });
    expect(state.units.has(cell(3, 1))).toBe(true);

    expect(playOut(state)).toBe(2);
    expect(isWon(state)).toBe(true);
  });

  it('goes back to refusing if the plug is pulled out again', () => {
    const { state } = boardFor('b3-sealed-room');
    slideGroupBy(state, 'p', -1, 0);
    slideGroupBy(state, 'p', 1, 0);
    expect(playOut(state)).toBe(0);
  });
});

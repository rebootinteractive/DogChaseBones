import { describe, it, expect } from 'vitest';
import { FIXTURE_LEVELS } from './fixtures/levels';
import { analyze, distToWin, key, playOut, render } from './softlock/analyze';
import { parseLevel } from '../src/game/level';
import { createBoard } from '../src/game/board';
import { validateLevel } from '../src/game/validate';
import { slideGroupBy } from '../src/game/slide';
import { idx } from '../src/game/cells';
import type { LevelData } from '../src/shared/types';
import noBee from './softlock/levels/sl-no-bee.json';
import oneBee from './softlock/levels/sl-one-bee.json';
import twoBees from './softlock/levels/sl-two-bees.json';

/**
 * Soft locks: reachable board states from which the level can never be won,
 * in a level that was winnable to begin with. The game has no detection for
 * this -- the clock is the only loss condition -- so a player who walks into
 * one just sits there until the timer runs out.
 *
 * `analyze` walks the entire reachable state graph and marks a state dead when
 * no sequence of drags from it reaches a win. See tests/softlock/analyze.ts.
 */

describe('the shipped fixture levels', () => {
  it.each(FIXTURE_LEVELS.map((l) => [l.id, l] as const))('%s has no soft lock', (_id, level) => {
    const a = analyze(level);
    expect(a.winnable).toBe(true);
    expect([...a.dead]).toEqual([]);
  });
});

/**
 * The only thing on this board that stops a dog but not a block is bee reach.
 * Every other obstacle -- wall, dead cell, unit, reservation -- blocks both
 * equally, and a drag with no bite is always undoable by dragging back. So in
 * a bee-free level the player can always restore any earlier arrangement, and
 * every dog sharing a region can reach every bone in it: no bite can strand a
 * later dog. This level is built to look like the classic trap -- the greedy
 * resolver spends a dog on a bone another queue was waiting for -- and it
 * still cannot be locked.
 */
describe('sl-no-bee', () => {
  const level = noBee as LevelData;

  it('is winnable and has no reachable dead state', () => {
    const a = analyze(level);
    expect(a.winnable).toBe(true);
    expect(a.dead.size).toBe(0);
    expect(a.fatal).toBeNull();
  });

  it('costs at most one extra drag however badly it is opened', () => {
    const a = analyze(level);
    const d = distToWin(a);
    const best = d.get(a.start)!;
    const worst = Math.max(...a.nodes.get(a.start)!.edges.map((e) => d.get(e.to)!));
    expect(best).toBe(4);
    expect(worst).toBeLessThanOrEqual(best + 1);
  });
});

/**
 * A bee needs two ways out and the player only two plugs, one of which is a
 * bone. Eating that bone destroys the block that was sealing its door, and no
 * plug is left for it -- the flood is permanent and the second bone can never
 * be reached. The bar carrying that second bone is boxed in on all four sides,
 * so it can neither plug a door nor be parked on the queue's entry cell.
 */
describe('sl-one-bee', () => {
  const level = oneBee as LevelData;
  const cell = (c: number, r: number) => idx(6, c, r);

  it('the editor reports nothing wrong with it', () => {
    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(validateLevel(spec)).toEqual([]);
  });

  it('is winnable, and can be soft-locked', () => {
    const a = analyze(level);
    expect(a.winnable).toBe(true);
    expect(distToWin(a).get(a.start)).toBe(3);
    expect(a.dead.size).toBeGreaterThan(0);
  });

  it('locks when the bone block plugs the door nearest the queue', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);

    // Both doors open: the bee owns the whole hall and nobody moves.
    expect(state.queues[0].remaining).toBe(2);

    // Seal the near door with the bone block, the far one with the plain block.
    slideGroupBy(state, 'd', -1, 0);   // d -> (0,1), plugging the left door
    slideGroupBy(state, 'p', 1, 0);    // p -> (5,1), plugging the right door
    playOut(state);

    // The hall cleared, and the nearest bone was the plug itself.
    expect(state.units.has(cell(0, 1))).toBe(false);
    expect(state.queues[0].remaining).toBe(1);

    const a = analyze(level);
    expect(a.dead.has(key(state))).toBe(true);
    // One bone and one dog left, and nothing that can ever bring them together.
    expect(render(state)).toEqual(['......', '.....p', '.#.##.', '.#Cc#.', '.####.', '..*...']);
  });

  it('is won by sealing the far door with the bone block instead', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);

    slideGroupBy(state, 'd', -1, 0);   // d -> (0,1)
    slideGroupBy(state, 'd', 0, 4);    // d -> (0,5), the far end of the left door
    slideGroupBy(state, 'p', 1, 0);    // p -> (5,1), plugging the right door
    playOut(state);

    expect(state.queues[0].remaining).toBe(0);
    expect(state.walkers).toEqual([]);
  });

  /**
   * A bone parked on a queue's entry cell is eaten from the queue with no route
   * at all -- the check runs before bee reach is even consulted. So a bone block
   * that can reach an entry cell can always be handed to a dog, bees or no bees,
   * and if that block was holding a door shut the level dies with it.
   */
  it('also locks by parking the bone block on the queue entry', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);

    slideGroupBy(state, 'd', 0, -1);   // d -> (1,0)
    slideGroupBy(state, 'd', -1, 0);   // d -> (0,0), the entry cell
    playOut(state);

    expect(state.units.has(cell(0, 0))).toBe(false);   // eaten off the queue
    expect(state.queues[0].remaining).toBe(1);
    expect(analyze(level).dead.has(key(state))).toBe(true);
  });
});

/** The same trap with the one chamber split into two, one bee in each. */
describe('sl-two-bees', () => {
  it('is winnable, and can be soft-locked', () => {
    const a = analyze(twoBees as LevelData);
    expect(a.winnable).toBe(true);
    expect(a.dead.size).toBeGreaterThan(0);
  });
});

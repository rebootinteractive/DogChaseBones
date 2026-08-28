import { describe, it, expect } from 'vitest';
import { FIXTURE_LEVELS } from './fixtures/levels';
import { analyze, distToWin, frozenGroups, groupAt, key, playOut, render } from './softlock/analyze';
import { parseLevel } from '../src/game/level';
import { createBoard, queuesOf, takeBone, dogsRemaining } from '../src/game/board';
import { resolveMoves } from '../src/game/resolve';
import { validateLevel } from '../src/game/validate';
import { slideGroupBy } from '../src/game/slide';
import { isWon } from '../src/game/resolve';
import { idx } from '../src/game/cells';
import type { LevelData } from '../src/shared/types';
import { levelFromAscii } from './helpers';
import noBee from './softlock/levels/sl-no-bee.json';
import oneBee from './softlock/levels/sl-one-bee.json';
import twoBees from './softlock/levels/sl-two-bees.json';
import designer from '../src/levels/published/softlock.json';

/**
 * Soft locks: reachable board states from which the level can never be won,
 * in a level that was winnable to begin with. The game has no detection for
 * this -- the clock is the only loss condition -- so a player who walks into
 * one just sits there until the timer runs out.
 *
 * `analyze` walks the entire reachable state graph and marks a state dead when
 * no sequence of drags from it reaches a win. See tests/softlock/analyze.ts.
 *
 * There are two ways to lose a level for good, and they have nothing in common
 * except that both turn on a bite:
 *
 *   1. A bee whose plug carries a bone. Eating it destroys the block that was
 *      sealing the flood, and the flood is permanent.  -- sl-one-bee
 *   2. A frozen group. A block group boxed in on all four sides is a wall the
 *      level never declared, and eating a bone off it makes it smaller and so
 *      possibly mobile. It is a one-way door whose key is the bone behind it;
 *      spend the only dog that can turn that key and the door never opens.
 *      No bee involved.  -- SoftLock, below
 */

describe('the shipped fixture levels', () => {
  it.each(FIXTURE_LEVELS.map((l) => [l.id, l] as const))('%s has no soft lock', (_id, level) => {
    const a = analyze(level);
    expect(a.winnable).toBe(true);
    expect([...a.dead]).toEqual([]);
  });
});

/**
 * A near-miss, kept as a control. The player does not choose which dog walks or
 * which bone it takes -- `resolveMoves` sends every leader that has a route and
 * `findRoute` hands it the nearest unclaimed bone -- so opening a corridor early
 * lets one queue's dog eat the bone another was waiting for.
 *
 * In *this* level that is recoverable: nothing here is frozen, so any block can
 * be dragged aside and the stranded dog walks the same corridor to the other
 * bone. Compare `SoftLock`, where a frozen bar makes the same theft permanent.
 */

describe('sl-no-bee', () => {
  const level = noBee as LevelData;

  it('is winnable and, in this layout, has no reachable dead state', () => {
    const a = analyze(level);
    expect(a.winnable).toBe(true);
    expect(a.dead.size).toBe(0);
    expect(a.fatal).toBeNull();
  }, 60_000);

  it('costs at most one extra drag however badly it is opened', () => {
    const a = analyze(level);
    const d = distToWin(a);
    const best = d.get(a.start)!;
    const worst = Math.max(...a.nodes.get(a.start)!.edges.map((e) => d.get(e.to)!));
    expect(best).toBe(4);
    expect(worst).toBeLessThanOrEqual(best + 1);
  }, 60_000);
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
    expect(queuesOf(state)[0].remaining).toBe(2);

    // Seal the near door with the bone block, the far one with the plain block.
    const d = groupAt(state, idx(6, 1, 1));
    const p = groupAt(state, idx(6, 4, 1));
    slideGroupBy(state, d, -1, 0);   // d -> (0,1), plugging the left door
    slideGroupBy(state, p, 1, 0);    // p -> (5,1), plugging the right door
    playOut(state);

    // The hall cleared, and the nearest bone was the plug itself.
    expect(state.unitAt.has(cell(0, 1))).toBe(false);
    expect(queuesOf(state)[0].remaining).toBe(1);

    const a = analyze(level);
    expect(a.dead.has(key(state))).toBe(true);
    // One bone and one dog left, and nothing that can ever bring them together.
    expect(render(state)).toEqual(['......', '.....a', '.#.##.', '.#Bb#.', '.####.', '..*...']);
  });

  it('is won by sealing the far door with the bone block instead', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);

    const d = groupAt(state, idx(6, 1, 1));
    const p = groupAt(state, idx(6, 4, 1));
    slideGroupBy(state, d, -1, 0);   // d -> (0,1)
    slideGroupBy(state, d, 0, 4);    // d -> (0,5), the far end of the left door
    slideGroupBy(state, p, 1, 0);    // p -> (5,1), plugging the right door
    playOut(state);

    expect(queuesOf(state)[0].remaining).toBe(0);
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

    const d = groupAt(state, idx(6, 1, 1));
    slideGroupBy(state, d, 0, -1);   // d -> (1,0)
    slideGroupBy(state, d, -1, 0);   // d -> (0,0), the entry cell
    playOut(state);

    expect(state.unitAt.has(cell(0, 0))).toBe(false);   // eaten off the queue
    expect(queuesOf(state)[0].remaining).toBe(1);
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


/**
 * Ordering is the one addition that changes *which* bones are targetable over
 * time, which the bee-free safety argument never considered. This pins the
 * behaviour on a deterministic board; the empirical sweep is in docs/soft-locks.md.
 */
describe('sl-tiers -- bone order on a bee-free board', () => {
  const tiered = levelFromAscii(
    ['.A..', '.#..', '..+.'],
    [{ c: 0, r: 0, dir: 'up', count: 2 }],
    { schema: 2 },
    ['.2..', '....', '..1.'],
  );

  const at = (c: number, r: number) => idx(4, c, r);

  it('sends the first dog past the near bone to the active tier', () => {
    const { spec } = parseLevel(tiered);
    const state = createBoard(spec);
    // The tier-2 bone sits on the entry cell's neighbour and would be eaten
    // immediately if tiers did not gate it. The tier-1 grid bone is four cells
    // away, and goes first.
    const out = resolveMoves(state);
    expect(out).toHaveLength(1);
    expect(out[0].boneCell).toBe(at(2, 2));
    expect(out[0].path).toEqual([at(0, 0), at(0, 1), at(0, 2), at(1, 2)]);
  });

  it('is winnable and cannot be locked', () => {
    const a = analyze(tiered);
    expect(a.winnable).toBe(true);
    expect(a.dead.size).toBe(0);
  });
});

/**
 * The designer's level, and the case that disproved the "only a bee can lock a
 * level" claim this file used to make.
 *
 * `g1` is a three-wide bar at (0,3)(1,3)(2,3), boxed in by walls above at (0,2)
 * and (2,2), below at (0,4), right at (3,3), and the grid edge on the left. It
 * cannot step in any direction: it is a wall the level never declared, and it
 * is the only route between the top-left room and the bottom corridor.
 *
 * The top-left dog is sealed behind it. The bottom-right dog is the only one
 * that can reach the bone the bar carries, from (2,4) -- and eating it shrinks
 * the bar to two cells, which *can* move, which is what finally lets the
 * top-left dog out. So that one bite is the key to the door.
 *
 * Spend the bottom-right dog on the other bone instead and the door stays shut
 * for good. Which is what happens by default: `g3` sits on that dog's entry
 * cell, and the moment it is dragged off, the dog takes the nearest bone -- the
 * one on `g2`, two steps away, the wrong one.
 */
describe('SoftLock (published) -- a frozen group, and no bee', () => {
  const level = designer as LevelData;
  const cell = (c: number, r: number) => idx(7, c, r);
  // one graph, shared: it is ~2600 states with corner drags and costs a few seconds
  let cached: ReturnType<typeof analyze> | undefined;
  const analysis = () => (cached ??= analyze(level, 200_000, true));

  it('has no bees, and the editor reports nothing wrong with it', () => {
    const { spec, issues } = parseLevel(level);
    expect(issues).toEqual([]);
    expect(validateLevel(spec)).toEqual([]);
    expect(spec.bees.size).toBe(0);
  });

  it('g1 is frozen, and eating its bone is what unfreezes it', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);

    expect(frozenGroups(state)).toEqual([0]);   // the bar, the board's first group

    takeBone(state, cell(2, 3));
    expect(frozenGroups(state)).toEqual([]);   // two cells now, and it fits
  });

  it('is winnable, and can be soft-locked', () => {
    const a = analysis();
    expect(a.winnable).toBe(true);
    expect(distToWin(a).get(a.start)).toBe(3);
    expect(a.dead.size).toBe(14);
  }, 60_000);

  it('every dead state is the same one: the bar keeps its bone forever', () => {
    const a = analysis();
    for (const k of a.dead) {
      const s = a.nodes.get(k)!.state;
      expect([...s.bones.keys()]).toEqual([cell(2, 3)]);
      expect(dogsRemaining(s)).toBe(1);
    }
  }, 60_000);

  it('over half the opening drags lose the level outright', () => {
    const a = analysis();
    const start = a.nodes.get(a.start)!;
    const fatal = start.edges.filter((e) => a.dead.has(e.to)).length;
    expect(start.edges.length).toBe(306);
    expect(fatal).toBe(156);
  }, 60_000);

  it('locks the moment the bottom-right dog is let out at the wrong bone', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);
    expect(dogsRemaining(state)).toBe(2);      // g3 covers the entry, nobody moves

    slideGroupBy(state, groupAt(state, cell(6, 4)), 0, -1);   // the corner block, off the entry cell
    playOut(state);

    // the nearest bone was g2's, two steps away. It is gone, and with it the level.
    expect([...state.bones.keys()]).toEqual([cell(2, 3)]);
    expect(analysis().dead.has(key(state))).toBe(true);
  }, 60_000);

  it('is won by putting the near bone out of reach before opening the entry', () => {
    const { spec } = parseLevel(level);
    const state = createBoard(spec);
    playOut(state);

    slideGroupBy(state, groupAt(state, cell(4, 3)), 2, -3);   // the bone up to the top-right corner
    slideGroupBy(state, groupAt(state, cell(6, 4)), 0, -1);   // the corner block up, walling the column off
    playOut(state);
    // forced left along the bottom corridor, the dog takes the bar's bone
    expect(state.bones.has(cell(2, 3))).toBe(false);

    // The bar is two cells now and can move -- but it has to be parked out of the
    // bottom corridor, not in it, or it simply becomes the next wall.
    slideGroupBy(state, groupAt(state, cell(1, 3)), 5, 1);   // what is left of the bar
    playOut(state);
    expect(isWon(state)).toBe(true);
  }, 60_000);
});

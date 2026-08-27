import { takeBone } from './board';
import type { BoardState, Walker } from './board';
import { beeReach, findRoute } from './pathing';

/**
 * Rebuild the reserved set from the walkers. A walker holds its whole route
 * *and* the cell of the bone it is coming for, so neither can be moved out from
 * under it. Derived rather than patched, so it can never drift.
 */
function syncReserved(state: BoardState) {
  state.reserved.clear();
  for (const w of state.walkers) {
    for (const cell of w.path) state.reserved.add(cell);
    state.reserved.add(w.boneCell);
  }
}

export interface Commitment {
  queueId: string;
  path: number[];
  boneCell: number;
}

/**
 * Bones already spoken for, counted per cell. A unit can carry a stack, so two
 * dogs may legitimately be walking towards the same cell -- but never towards
 * more bones than are actually on it.
 */
function claimedBones(state: BoardState): Map<number, number> {
  const claims = new Map<number, number>();
  for (const w of state.walkers) claims.set(w.boneCell, (claims.get(w.boneCell) ?? 0) + 1);
  return claims;
}

/**
 * Send every queue leader that now has a safe route. Called on drag release and
 * again after each bone is eaten, since a destroyed unit can open new routes.
 *
 * Committing a route reserves its cells, which also stops bee flood -- so a
 * later queue can become viable because an earlier dog set off. Passes repeat
 * until nothing new commits.
 */
export function resolveMoves(state: BoardState): Commitment[] {
  const committed: Commitment[] = [];
  const busy = new Set(state.walkers.map((w) => w.queueId));
  let progressed = true;

  while (progressed) {
    progressed = false;
    const bees = beeReach(state);
    const claimed = claimedBones(state);

    for (const q of state.queues) {
      if (q.remaining <= 0 || busy.has(q.id)) continue;

      const route = findRoute(state, q, bees, claimed);
      if (!route) continue;

      q.remaining--;
      busy.add(q.id);
      claimed.set(route.boneCell, (claimed.get(route.boneCell) ?? 0) + 1);
      state.walkers.push({ queueId: q.id, path: route.path, step: -1, boneCell: route.boneCell });
      syncReserved(state);
      committed.push({ queueId: q.id, path: route.path, boneCell: route.boneCell });
      progressed = true;
    }
  }

  return committed;
}

export interface EatResult {
  /** Groups that exist where the eaten unit's group used to be. More than one means it split. */
  groups: string[];
  boneCell: number;
  /** Bones still on that unit after this bite. */
  bonesLeft: number;
  /** True when that was the last bone and the unit went with it. */
  destroyed: boolean;
}

/**
 * The dog has arrived: take one bone off the unit and free the route. The unit
 * only goes when its last bone does -- and if it was the one thing holding its
 * group together, the group splits then.
 */
export function finishWalker(state: BoardState, walker: Walker): EatResult {
  state.walkers = state.walkers.filter((w) => w !== walker);
  syncReserved(state);

  const { bonesLeft, destroyed, groups } = takeBone(state, walker.boneCell);
  return { groups, boneCell: walker.boneCell, bonesLeft, destroyed };
}

export function isWon(state: BoardState): boolean {
  return state.walkers.length === 0 && state.queues.every((q) => q.remaining <= 0);
}

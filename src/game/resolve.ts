import { removeUnit } from './board';
import type { BoardState, Walker } from './board';
import { beeReach, findRoute } from './pathing';

export interface Commitment {
  queueId: string;
  path: number[];
  boneCell: number;
}

/** Bones already spoken for, so two dogs never race for the same one. */
function claimedBones(state: BoardState): Set<number> {
  return new Set(state.walkers.map((w) => w.boneCell));
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
      claimed.add(route.boneCell);
      for (const cell of route.path) state.reserved.add(cell);
      state.walkers.push({ queueId: q.id, path: route.path, step: -1, boneCell: route.boneCell });
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
}

/**
 * The dog has arrived: destroy the bone and its host unit, free the route, and
 * split the host's group if that unit was the only thing holding it together.
 */
export function finishWalker(state: BoardState, walker: Walker): EatResult {
  for (const cell of walker.path) state.reserved.delete(cell);
  state.walkers = state.walkers.filter((w) => w !== walker);
  const groups = removeUnit(state, walker.boneCell);
  return { groups, boneCell: walker.boneCell };
}

export function isWon(state: BoardState): boolean {
  return state.walkers.length === 0 && state.queues.every((q) => q.remaining <= 0);
}

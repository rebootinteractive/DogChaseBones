import { DIR_VEC, DIRS, colOf, idx, inBounds, rowOf } from './cells';
import { isPassable } from './board';
import type { BoardState, RuntimeQueue } from './board';

/**
 * Every cell a bee can currently get to, flooding outward through open cells.
 * Blocks, walls, dead cells, other bees and locked dog routes all stop it.
 * A dog will not walk a route that touches any of these cells -- the player has
 * to seal the corridor off from the bee first.
 */
export function beeReach(state: BoardState): Set<number> {
  const reach = new Set<number>();
  const frontier: number[] = [];

  for (const bee of state.bees) {
    for (const n of passableNeighbours(state, bee)) {
      if (!reach.has(n)) { reach.add(n); frontier.push(n); }
    }
  }

  while (frontier.length) {
    const cur = frontier.pop()!;
    for (const n of passableNeighbours(state, cur)) {
      if (!reach.has(n)) { reach.add(n); frontier.push(n); }
    }
  }
  return reach;
}

function passableNeighbours(state: BoardState, cell: number): number[] {
  const c = colOf(state.cols, cell);
  const r = rowOf(state.cols, cell);
  const out: number[] = [];
  for (const d of DIRS) {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (!inBounds(state.cols, state.rows, nc, nr)) continue;
    const n = idx(state.cols, nc, nr);
    if (isPassable(state, n)) out.push(n);
  }
  return out;
}

export interface Route {
  /** Cells from the queue's entry cell to the cell the dog eats from. */
  path: number[];
  /** The block unit carrying the bone this route was found for. */
  boneCell: number;
}

/**
 * Shortest safe route for a queue's leader: open cells only, right-angle turns,
 * never touching a cell the bee can reach, ending beside an unclaimed bone.
 * Returns null when the dog has to wait.
 */
export function findRoute(
  state: BoardState,
  queue: RuntimeQueue,
  bees: Set<number>,
  claimedBones: Set<number>,
): Route | null {
  const entry = queue.cell;
  if (!isPassable(state, entry) || bees.has(entry)) return null;

  const prev = new Map<number, number>();
  const seen = new Set<number>([entry]);
  let frontier = [entry];

  while (frontier.length) {
    const next: number[] = [];
    for (const cur of frontier) {
      const bone = adjacentBone(state, cur, claimedBones);
      if (bone !== null) return { path: rebuild(prev, entry, cur), boneCell: bone };

      for (const n of passableNeighbours(state, cur)) {
        if (seen.has(n) || bees.has(n)) continue;
        seen.add(n);
        prev.set(n, cur);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** First unclaimed bone orthogonally touching `cell`, scanned in DIRS order. */
function adjacentBone(state: BoardState, cell: number, claimed: Set<number>): number | null {
  const c = colOf(state.cols, cell);
  const r = rowOf(state.cols, cell);
  for (const d of DIRS) {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (!inBounds(state.cols, state.rows, nc, nr)) continue;
    const n = idx(state.cols, nc, nr);
    const unit = state.units.get(n);
    if (unit?.bone && !claimed.has(n)) return n;
  }
  return null;
}

function rebuild(prev: Map<number, number>, entry: number, goal: number): number[] {
  const path = [goal];
  let cur = goal;
  while (cur !== entry) {
    const p = prev.get(cur);
    if (p === undefined) break;
    path.push(p);
    cur = p;
  }
  return path.reverse();
}

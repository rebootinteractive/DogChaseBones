import { colOf, idx, inBounds, rowOf } from './cells';
import type { BoardState } from './board';

/**
 * Free-drag sliding, Color-Block-Jam style: a group follows the finger one cell
 * at a time and stops the instant any of its units would hit something.
 */

/** Can the whole group shift by (dc, dr) without overlapping anything but itself? */
export function canStepGroup(state: BoardState, group: string, dc: number, dr: number): boolean {
  const cells = state.groups.get(group);
  if (!cells || cells.size === 0) return false;
  if (dc === 0 && dr === 0) return false;

  for (const cell of cells) {
    // A dog has committed to a bone on this group. The group is pinned until it
    // finishes -- otherwise the bone could be slid out from under the dog.
    if (state.reserved.has(cell)) return false;

    const c = colOf(state.cols, cell) + dc;
    const r = rowOf(state.cols, cell) + dr;
    if (!inBounds(state.cols, state.rows, c, r)) return false;

    const target = idx(state.cols, c, r);
    if (cells.has(target)) continue;               // vacated by this same group
    if (state.dead.has(target)) return false;
    if (state.walls.has(target)) return false;
    if (state.bees.has(target)) return false;
    if (state.units.has(target)) return false;     // another group
    if (state.reserved.has(target)) return false;  // a dog's locked route
  }
  return true;
}

/** Apply a single-cell step. Returns false and changes nothing when blocked. */
export function stepGroup(state: BoardState, group: string, dc: number, dr: number): boolean {
  if (!canStepGroup(state, group, dc, dr)) return false;

  const cells = state.groups.get(group)!;
  const moving = [...cells].map((cell) => ({
    cell,
    unit: state.units.get(cell)!,
    bones: state.bones.get(cell),
  }));

  // Clear the whole footprint first: a group may slide over its own cells, so
  // a cell-by-cell move would overwrite an entry it still needs.
  for (const { cell } of moving) {
    state.units.delete(cell);
    state.bones.delete(cell);
  }

  const next = new Set<number>();
  for (const { cell, unit, bones } of moving) {
    const target = idx(state.cols, colOf(state.cols, cell) + dc, rowOf(state.cols, cell) + dr);
    state.units.set(target, unit);
    if (bones) state.bones.set(target, bones);
    next.add(target);
  }
  state.groups.set(group, next);
  return true;
}

/**
 * Walk the group as far towards (wantDc, wantDr) as it can get, stepping the
 * axis with the most distance left first so a drag can round a corner in one
 * gesture. Returns the offset actually applied.
 */
export function slideGroupBy(
  state: BoardState,
  group: string,
  wantDc: number,
  wantDr: number,
): { dc: number; dr: number } {
  let dc = 0;
  let dr = 0;
  let guard = Math.abs(wantDc) + Math.abs(wantDr);

  while (guard-- > 0) {
    const restC = wantDc - dc;
    const restR = wantDr - dr;
    if (restC === 0 && restR === 0) break;

    const stepC = Math.sign(restC);
    const stepR = Math.sign(restR);
    const preferC = Math.abs(restC) >= Math.abs(restR);

    const first: [number, number] = preferC ? [stepC, 0] : [0, stepR];
    const second: [number, number] = preferC ? [0, stepR] : [stepC, 0];

    let advanced = false;
    for (const [sc, sr] of [first, second]) {
      if (sc === 0 && sr === 0) continue;
      if (stepGroup(state, group, sc, sr)) { dc += sc; dr += sr; advanced = true; break; }
    }
    if (!advanced) break;
  }

  return { dc, dr };
}

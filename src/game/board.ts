import { DIRS, DIR_VEC, colOf, connectedComponents, idx, inBounds, rowOf } from './cells';
import type { Dir } from './cells';
import type { BoneStack, LevelSpec } from './level';

export { connectedComponents };

/**
 * One block group: the cells it occupies, and nothing else.
 *
 * A group has no id. It *is* the object -- two groups are different because
 * they are different objects, not because they carry different strings. That
 * matters because a group splits during play: the piece that loses the block
 * holding it together keeps one part, and the other parts become new objects
 * pushed onto the board's list. Nothing is renamed, so a reference taken before
 * a split is still a valid handle on a real piece afterwards.
 */
export interface BlockGroup {
  cells: Set<number>;
}

/**
 * Where a dog comes from. A queue holds several dogs at an off-board slot and
 * only its leader is live; a grid dog is a single dog standing on a cell it
 * occupies. Both walk the same route-finding and eating path.
 */
export type DogSource =
  | { kind: 'queue'; id: string; cell: number; dir: Dir; remaining: number }
  | { kind: 'grid'; id: string; cell: number };

export type RuntimeQueue = Extract<DogSource, { kind: 'queue' }>;

/** A dog that has committed to a route. Its whole path is reserved until it eats. */
export interface Walker {
  sourceId: string;
  /** Cells from the entry cell to the cell the dog eats from. */
  path: number[];
  /** Index into `path`; -1 while the dog is still outside the grid. */
  step: number;
  boneCell: number;
}

export interface BoardState {
  cols: number;
  rows: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  /** Every block group on the board, in no particular order. */
  groups: BlockGroup[];
  /**
   * Which group holds each cell. A derived index over `groups`, kept in step by
   * the same functions that move cells -- `isBlocked` runs hot and needs a cell
   * lookup, but `groups` stays the only place a piece lives.
   */
  unitAt: Map<number, BlockGroup>;
  /** Every bone by cell, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
  /** Every dog still to walk -- queues, and dogs standing on the board. */
  sources: DogSource[];
  /**
   * Cells held by a grid dog. A derived index over `sources`, rebuilt rather
   * than patched so it can never drift.
   */
  gridDogs: Set<number>;
  walkers: Walker[];
  /** Union of every walker's path. Blocks slides, dogs and bee flood alike. */
  reserved: Set<number>;
}

export function createBoard(spec: LevelSpec): BoardState {
  const groups: BlockGroup[] = [];
  const unitAt = new Map<number, BlockGroup>();
  for (const cells of spec.shapes) {
    const group: BlockGroup = { cells: new Set(cells) };
    groups.push(group);
    for (const cell of group.cells) unitAt.set(cell, group);
  }

  return {
    cols: spec.cols,
    rows: spec.rows,
    dead: new Set(spec.dead),
    walls: new Set(spec.walls),
    bees: new Set(spec.bees),
    groups,
    unitAt,
    bones: new Map([...spec.bones].map(([cell, s]) => [cell, { ...s }])),
    sources: [
      ...spec.queues.map((q): DogSource => ({ kind: 'queue', id: q.id, cell: q.cell, dir: q.dir, remaining: q.count })),
      ...spec.gridDogs.map((cell, n): DogSource => ({ kind: 'grid', id: `d${n}`, cell })),
    ],
    gridDogs: new Set(spec.gridDogs),
    walkers: [],
    reserved: new Set(),
  };
}

/** True when nothing can occupy or pass through this cell right now. */
export function isBlocked(state: BoardState, cell: number): boolean {
  return (
    state.dead.has(cell) ||
    state.walls.has(cell) ||
    state.bees.has(cell) ||
    state.unitAt.has(cell) ||
    state.bones.has(cell) ||
    state.gridDogs.has(cell) ||
    state.reserved.has(cell)
  );
}

/** True when a dog could stand here and a bee could fly through here. */
export function isPassable(state: BoardState, cell: number): boolean {
  return cell >= 0 && cell < state.cols * state.rows && !isBlocked(state, cell);
}

/** Cell just outside the grid-facing side of a queue, `n` dogs back. */
export function queueSlot(state: BoardState, q: RuntimeQueue, n: number): { c: number; r: number } {
  const { dc, dr } = DIR_VEC[q.dir];
  return { c: colOf(state.cols, q.cell) + dc * (n + 1), r: rowOf(state.cols, q.cell) + dr * (n + 1) };
}

/**
 * A queue is well-formed when its outward neighbour is off-grid or dead --
 * that is what makes its cell a boundary the dogs can walk in from. A wall does
 * not count: dogs come from outside the board, and a wall is inside it.
 */
export function isBoundaryFor(spec: { cols: number; rows: number; dead: Set<number> }, cell: number, dir: Dir): boolean {
  const { dc, dr } = DIR_VEC[dir];
  const c = colOf(spec.cols, cell) + dc;
  const r = rowOf(spec.cols, cell) + dr;
  if (!inBounds(spec.cols, spec.rows, c, r)) return true;
  return spec.dead.has(idx(spec.cols, c, r));
}

/** Every outward direction that would make `cell` a valid queue entry. */
export function boundaryDirs(spec: { cols: number; rows: number; dead: Set<number> }, cell: number): Dir[] {
  return DIRS.filter((d) => isBoundaryFor(spec, cell, d));
}

/**
 * Take one cell out of the board and, if that leaves its group in pieces, break
 * the group up. The original object keeps one part; every other part becomes a
 * new group pushed onto `state.groups`.
 *
 * Returns the groups that exist where the old one was: empty when the last cell
 * went, one when it held together, more than one when it split.
 */
export function destroyCell(state: BoardState, cell: number): BlockGroup[] {
  const group = state.unitAt.get(cell);
  if (!group) return [];

  group.cells.delete(cell);
  state.unitAt.delete(cell);

  if (group.cells.size === 0) {
    state.groups = state.groups.filter((g) => g !== group);
    return [];
  }

  const parts = connectedComponents(state.cols, state.rows, group.cells);
  if (parts.length === 1) return [group];

  // The bridge cell is gone -- the piece falls apart. One part stays with the
  // original object so anything already holding it keeps a live reference.
  group.cells = parts[0];
  const out = [group];
  for (const part of parts.slice(1)) {
    const extra: BlockGroup = { cells: part };
    state.groups.push(extra);
    for (const c of part) state.unitAt.set(c, extra);
    out.push(extra);
  }
  return out;
}

/**
 * Islands of the board: regions nothing can ever travel between. Dead cells,
 * walls and bees all fence a region off, because none of them ever move --
 * blocks do not, since sliding one out of the way is the game.
 */
export function islands(
  spec: { cols: number; rows: number; dead: Set<number>; walls: Set<number>; bees: Set<number> },
): Set<number>[] {
  const live = new Set<number>();
  for (let i = 0; i < spec.cols * spec.rows; i++) {
    if (!spec.dead.has(i) && !spec.walls.has(i) && !spec.bees.has(i)) live.add(i);
  }
  return connectedComponents(spec.cols, spec.rows, live);
}

/**
 * The lowest tier still on the board -- the only tier a dog may eat from.
 * Null when no bones remain, which is the state where the last walkers are
 * still finishing and there is nothing left to claim.
 *
 * A *claimed* bone still counts as remaining, so a tier unlocks when the last
 * lower-tier bone is eaten, not when the last one is spoken for.
 */
export function activeOrder(state: BoardState): number | null {
  let lowest: number | null = null;
  for (const stack of state.bones.values()) {
    if (stack.count <= 0) continue;
    if (lowest === null || stack.order < lowest) lowest = stack.order;
  }
  return lowest;
}

/**
 * Take one bone off a cell. The single place a bone can disappear, which is
 * what keeps `activeOrder` honest. When the stack empties, the block underneath
 * -- if there is one -- goes with it and its group may split.
 */
export function takeBone(
  state: BoardState,
  cell: number,
): { bonesLeft: number; destroyed: boolean; groups: BlockGroup[] } {
  const stack = state.bones.get(cell);
  if (!stack) return { bonesLeft: 0, destroyed: false, groups: [] };

  const group = state.unitAt.get(cell);

  stack.count -= 1;
  if (stack.count > 0) {
    return { bonesLeft: stack.count, destroyed: false, groups: group ? [group] : [] };
  }

  state.bones.delete(cell);
  if (!group) return { bonesLeft: 0, destroyed: false, groups: [] };

  // The host goes with its last bone -- and if it was the one thing holding its
  // group together, `destroyCell` reports the groups it fell apart into.
  return { bonesLeft: 0, destroyed: true, groups: destroyCell(state, cell) };
}

export function bonesRemaining(state: BoardState): number {
  let n = 0;
  for (const stack of state.bones.values()) n += stack.count;
  return n;
}

export function dogsRemaining(state: BoardState): number {
  const waiting = state.sources.reduce((n, s) => n + (s.kind === 'queue' ? s.remaining : 1), 0);
  return waiting + state.walkers.length;
}

/**
 * Rebuild the grid-dog cell index from `sources`. Derived rather than patched,
 * so it can never drift -- the same discipline as `syncReserved`.
 */
export function syncGridDogs(state: BoardState) {
  state.gridDogs.clear();
  for (const s of state.sources) if (s.kind === 'grid') state.gridDogs.add(s.cell);
}

/** The queue sources, for render code that draws waiting lines of dogs. */
export function queuesOf(state: BoardState): RuntimeQueue[] {
  return state.sources.filter((s): s is RuntimeQueue => s.kind === 'queue');
}

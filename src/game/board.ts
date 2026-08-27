import { DIR_VEC, DIRS, colOf, idx, inBounds, rowOf } from './cells';
import type { Dir } from './cells';
import type { BoneStack, LevelSpec } from './level';

export interface Unit {
  group: string;
  colorKey?: string;
}

export interface RuntimeQueue {
  id: string;
  cell: number;
  dir: Dir;
  /** Dogs still waiting, leader included. */
  remaining: number;
}

/** A dog that has committed to a route. Its whole path is reserved until it eats. */
export interface Walker {
  queueId: string;
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
  units: Map<number, Unit>;
  /** Every bone by cell, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
  groups: Map<string, Set<number>>;
  queues: RuntimeQueue[];
  walkers: Walker[];
  /** Union of every walker's path. Blocks slides, dogs and bee flood alike. */
  reserved: Set<number>;
}

/**
 * A group is a *connected component within an authored id*, not the id itself.
 * Two lumps painted the same colour but not touching are two separate groups
 * and slide independently; make them touch in the editor and they become one.
 * Two different ids that touch stay separate, which is what the id is for.
 */
export function createBoard(spec: LevelSpec): BoardState {
  const units = new Map<number, Unit>();
  const authored = new Map<string, Set<number>>();
  for (const u of spec.units) {
    const unit: Unit = { group: u.group };
    if (u.colorKey !== undefined) unit.colorKey = u.colorKey;
    units.set(u.cell, unit);
    let set = authored.get(u.group);
    if (!set) { set = new Set(); authored.set(u.group, set); }
    set.add(u.cell);
  }

  const groups = new Map<string, Set<number>>();
  for (const [id, cells] of authored) {
    const parts = connectedComponents(spec.cols, spec.rows, cells);
    parts.forEach((part, n) => {
      // Keep the authored id when it is already one piece, so level ids stay readable.
      const gid = parts.length === 1 ? id : `${id}#${n}`;
      groups.set(gid, part);
      for (const cell of part) units.get(cell)!.group = gid;
    });
  }

  return {
    cols: spec.cols,
    rows: spec.rows,
    dead: new Set(spec.dead),
    walls: new Set(spec.walls),
    bees: new Set(spec.bees),
    units,
    bones: new Map([...spec.bones].map(([cell, s]) => [cell, { ...s }])),
    groups,
    queues: spec.queues.map((q) => ({ id: q.id, cell: q.cell, dir: q.dir, remaining: q.count })),
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
    state.units.has(cell) ||
    state.bones.has(cell) ||
    state.reserved.has(cell)
  );
}

/** True when a dog could stand here and a bee could fly through here. */
export function isPassable(state: BoardState, cell: number): boolean {
  return cell >= 0 && cell < state.cols * state.rows && !isBlocked(state, cell);
}

export function groupCells(state: BoardState, group: string): number[] {
  return [...(state.groups.get(group) ?? [])];
}

/** Cell just outside the grid-facing side of a queue, `n` dogs back. */
export function queueSlot(state: BoardState, q: RuntimeQueue, n: number): { c: number; r: number } {
  const { dc, dr } = DIR_VEC[q.dir];
  return { c: colOf(state.cols, q.cell) + dc * (n + 1), r: rowOf(state.cols, q.cell) + dr * (n + 1) };
}

/**
 * A queue is well-formed when its outward neighbour is off-grid or dead --
 * that is what makes its cell a boundary the dogs can walk in from.
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
 * Remove one unit and re-split its group into connected components.
 * Returns the group ids that exist afterwards where the old one was.
 */
export function removeUnit(state: BoardState, cell: number): string[] {
  const unit = state.units.get(cell);
  if (!unit) return [];
  state.units.delete(cell);

  const set = state.groups.get(unit.group);
  if (!set) return [];
  set.delete(cell);
  if (set.size === 0) { state.groups.delete(unit.group); return []; }

  const components = connectedComponents(state.cols, state.rows, set);
  if (components.length <= 1) return [unit.group];

  // The bridge unit is gone -- the group falls apart into independent groups.
  state.groups.delete(unit.group);
  const ids: string[] = [];
  components.forEach((comp, n) => {
    const id = `${unit.group}#${n}`;
    state.groups.set(id, comp);
    for (const c of comp) {
      const u = state.units.get(c);
      if (u) u.group = id;
    }
    ids.push(id);
  });
  return ids;
}

/** 4-adjacency connected components within `cells`. */
export function connectedComponents(cols: number, rows: number, cells: Set<number>): Set<number>[] {
  const seen = new Set<number>();
  const out: Set<number>[] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const comp = new Set<number>([start]);
    seen.add(start);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      const c = colOf(cols, cur);
      const r = rowOf(cols, cur);
      for (const d of DIRS) {
        const { dc, dr } = DIR_VEC[d];
        const nc = c + dc;
        const nr = r + dr;
        if (!inBounds(cols, rows, nc, nr)) continue;
        const n = idx(cols, nc, nr);
        if (!cells.has(n) || seen.has(n)) continue;
        seen.add(n);
        comp.add(n);
        stack.push(n);
      }
    }
    out.push(comp);
  }
  return out;
}

/** Islands of the grid: connected components of the cells that are not dead. */
export function islands(spec: { cols: number; rows: number; dead: Set<number> }): Set<number>[] {
  const live = new Set<number>();
  for (let i = 0; i < spec.cols * spec.rows; i++) if (!spec.dead.has(i)) live.add(i);
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
 * what keeps `activeOrder` honest. When the stack empties, the block unit
 * underneath -- if there is one -- goes with it and its group re-splits.
 */
export function takeBone(
  state: BoardState,
  cell: number,
): { bonesLeft: number; destroyed: boolean; groups: string[] } {
  const stack = state.bones.get(cell);
  if (!stack) return { bonesLeft: 0, destroyed: false, groups: [] };

  const group = state.units.get(cell)?.group;

  stack.count -= 1;
  if (stack.count > 0) {
    return { bonesLeft: stack.count, destroyed: false, groups: group ? [group] : [] };
  }

  state.bones.delete(cell);
  if (group === undefined) return { bonesLeft: 0, destroyed: false, groups: [] };

  // The host goes with its last bone -- and if it was the one thing holding its
  // group together, `removeUnit` reports the groups it fell apart into.
  return { bonesLeft: 0, destroyed: true, groups: removeUnit(state, cell) };
}

export function bonesRemaining(state: BoardState): number {
  let n = 0;
  for (const stack of state.bones.values()) n += stack.count;
  return n;
}

export function dogsRemaining(state: BoardState): number {
  return state.queues.reduce((n, q) => n + q.remaining, 0) + state.walkers.length;
}

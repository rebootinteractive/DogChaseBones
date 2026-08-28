import type { LevelData, GameElement } from '../shared/types';
import { colOf, connectedComponents, idx, inBounds, isDir, rowOf, type Dir } from './cells';

// ---------------------------------------------------------------------------
// Level element schema (GameElement.x / .y are integer CELL coordinates here,
// not normalized stage coords -- the camera fits the grid dynamically, so a
// normalized position would be meaningless).
//
//   { type: 'dead',  x, y }                     cell switched off; not part of the board
//   { type: 'wall',  x, y }                     static, unmovable, blocks everything
//   { type: 'bee',   x, y }                     fixed; poisons every cell it can reach
//   { type: 'block', x, y, cells }              ONE ELEMENT IS ONE BLOCK GROUP.
//                                               x,y is the anchor; `cells` are
//                                               [dx,dy] offsets from it and always
//                                               include [0,0].
//   { type: 'bone',  x, y, count?, order? }     rides a block cell. count defaults to
//                                               1 and stacks, so repeated bone elements
//                                               also add up. order is the activation
//                                               tier, default 1.
//   { type: 'gridBone', x, y, count?, order? }  a bone sitting on the grid itself.
//                                               Owns its cell and blocks everything
//                                               until it is eaten.
//   { type: 'gridDog',  x, y }                  a dog standing on the board. Blocks
//                                               everything until it eats, then it is gone.
//   { type: 'queue', x, y, dir, count }         entry cell; dogs line up towards `dir`
//
// meta: { schema, cols, rows, timeLimit }
//
// `schema` is the edition of this format. Levels are read by more than one
// program -- the web prototype now, Unity later -- built at different times. A
// format change without a version number fails silently: a level loads and
// plays wrong, which is far more expensive than one that refuses to load.
// Bump SCHEMA_VERSION on any change an older reader would misinterpret.
// ---------------------------------------------------------------------------

/**
 * Edition of the level format.
 *   1 -- initial: dead/wall/bee/block/bone/queue elements, meta cols/rows/timeLimit.
 *        Bones carry an optional `count`; absent means one. A block element was
 *        ONE CELL tagged with a `group` string, and a group was the connected run
 *        of cells sharing that tag.
 *   2 -- bones carry an optional `order` (activation tier, absent means 1), and
 *        the `gridBone` and `gridDog` elements arrive.
 *   3 -- a block element is a whole group: an anchor plus a `cells` list of
 *        offsets. `group` and `colorKey` are gone, and with them the class of
 *        bug where one tag covered two lumps that were never one piece.
 *        Editions 1 and 2 are still read -- their tags are split into connected
 *        components on the way in -- but the editor only ever writes edition 3.
 */
export const SCHEMA_VERSION = 3;

/** Highest activation tier. Matches the editor's nine tier chips. */
export const MAX_BONE_ORDER = 9;

export const DEFAULT_COLS = 6;
export const DEFAULT_ROWS = 10;
export const DEFAULT_TIME_LIMIT = 120;
export const MIN_DIM = 2;
export const MAX_DIM = 14;

/** A stack of bones on one cell. Every bone in the stack shares a tier. */
export interface BoneStack {
  count: number;
  /** Activation tier. Tier N is edible once every lower tier is eaten. */
  order: number;
}

export interface QueueSpec {
  id: string;
  cell: number;
  dir: Dir;
  count: number;
}

export interface LevelSpec {
  /** Edition the level was authored in. Levels predating the field are 1. */
  schema: number;
  cols: number;
  rows: number;
  timeLimit: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  /**
   * One entry per block group: the cells it occupies, ascending. A group has no
   * id -- it is identified at runtime by being an object in the board's list,
   * so a split pushes a new object rather than renaming anything.
   */
  shapes: number[][];
  /** Every bone on the board, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
  /** Cells holding a dog that stands on the board rather than queueing. */
  gridDogs: number[];
  queues: QueueSpec[];
}

export interface ParseResult {
  spec: LevelSpec;
  /** Content the parser had to drop. Surfaced by the editor, logged by the game. */
  issues: string[];
}

function clampDim(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : fallback;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Offsets as authored: a list of [dx, dy] pairs. Anything else is not a shape. */
function offsetsOf(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<[number, number]> = [];
  for (const pair of v) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const dx = num(pair[0]);
    const dy = num(pair[1]);
    if (dx === null || dy === null) return null;
    out.push([Math.round(dx), Math.round(dy)]);
  }
  return out;
}

export function parseLevel(level: LevelData): ParseResult {
  const meta = (level.meta ?? {}) as Record<string, unknown>;
  const cols = clampDim(meta.cols, DEFAULT_COLS);
  const rows = clampDim(meta.rows, DEFAULT_ROWS);
  const timeRaw = num(meta.timeLimit);
  const timeLimit = timeRaw !== null && timeRaw > 0 ? Math.round(timeRaw) : DEFAULT_TIME_LIMIT;

  // Absent means edition 1 -- levels authored before the field existed really
  // are edition 1, so this must stay 1 rather than tracking SCHEMA_VERSION.
  // A newer edition is refused loudly rather than guessed at.
  const schemaRaw = num(meta.schema);
  const schema = schemaRaw !== null && schemaRaw >= 1 ? Math.round(schemaRaw) : 1;

  const spec: LevelSpec = {
    schema, cols, rows, timeLimit,
    dead: new Set(), walls: new Set(), bees: new Set(),
    shapes: [], bones: new Map(), gridDogs: [], queues: [],
  };
  const issues: string[] = [];

  if (schema > SCHEMA_VERSION) {
    issues.push(
      `level is edition ${schema}; this build understands up to ${SCHEMA_VERSION}. ` +
      'It was made with a newer editor -- update before opening it.',
    );
  }

  const at = (cell: number) => `(${colOf(cols, cell)}, ${rowOf(cols, cell)})`;

  const cellOf = (c: number, r: number): number | null =>
    inBounds(cols, rows, c, r) ? idx(cols, c, r) : null;

  const anchorOf = (el: GameElement): number | null => {
    const c = num(el.x);
    const r = num(el.y);
    if (c === null || r === null) return null;
    return cellOf(Math.round(c), Math.round(r));
  };

  // A dead cell is not part of the board at all, so it is settled before
  // anything else: whether a shape overlaps one must not depend on where the
  // `dead` element happens to sit in the array.
  for (const el of level.elements) {
    if (el.type !== 'dead') continue;
    const cell = anchorOf(el);
    if (cell === null) {
      issues.push(`dead at (${String(el.x)}, ${String(el.y)}) is outside the ${cols}x${rows} grid`);
      continue;
    }
    spec.dead.add(cell);
  }

  // One occupant per cell: dead / wall / bee / gridDog / block are mutually
  // exclusive, and the first element in the array wins a contested cell.
  const occupant = new Map<number, string>();
  for (const cell of spec.dead) occupant.set(cell, 'dead');

  const bones: Array<{ cell: number; count: number; order: number; onGrid: boolean }> = [];
  /** Edition 1 and 2 blocks, held back so their tags can be split on the way out. */
  const tagged: Array<{ cell: number; tag: string }> = [];
  let queueSeq = 0;

  const claim = (cells: number[], group: number[][]) => {
    const set = new Set(cells);
    for (const c of cells) occupant.set(c, 'block');
    group.push([...set].sort((a, b) => a - b));
  };

  for (const el of level.elements) {
    if (el.type === 'dead') continue;   // settled above

    const cell = anchorOf(el);
    if (cell === null) {
      issues.push(`${el.type} at (${String(el.x)}, ${String(el.y)}) is outside the ${cols}x${rows} grid`);
      continue;
    }

    if (el.type === 'bone' || el.type === 'gridBone') {
      const raw = num(el.count);
      const rawOrder = num(el.order);
      const order = rawOrder === null
        ? 1
        : Math.min(MAX_BONE_ORDER, Math.max(1, Math.round(rawOrder)));
      bones.push({
        cell,
        count: Math.max(1, Math.round(raw ?? 1)),
        order,
        onGrid: el.type === 'gridBone',
      });
      continue;
    }

    if (el.type === 'queue') {
      const dir = isDir(el.dir) ? el.dir : 'up';
      const rawCount = num(el.count);
      const count = Math.max(1, Math.round(rawCount ?? 1));
      spec.queues.push({ id: `q${queueSeq++}`, cell, dir, count });
      continue;
    }

    if (el.type === 'block') {
      const offsets = offsetsOf(el.cells);

      // Edition 1 and 2: one cell per element, tagged with a `group` string.
      // The tag was never the group -- the connected run within it was -- so
      // these are collected and split below.
      if (offsets === null) {
        if (schema >= 3) {
          issues.push(`block at ${at(cell)} dropped -- no cells list`);
          continue;
        }
        if (occupant.has(cell)) {
          issues.push(`block at ${at(cell)} dropped -- already occupied by ${occupant.get(cell)}`);
          continue;
        }
        const tag = typeof el.group === 'string' && el.group ? el.group : `g-${cell}`;
        occupant.set(cell, 'block');
        tagged.push({ cell, tag });
        continue;
      }

      if (offsets.length === 0) {
        issues.push(`block at ${at(cell)} dropped -- empty cells list`);
        continue;
      }

      const ac = colOf(cols, cell);
      const ar = rowOf(cols, cell);
      const absolute: number[] = [];
      let offGrid = false;
      let onDead = false;
      for (const [dx, dy] of offsets) {
        const target = cellOf(ac + dx, ar + dy);
        if (target === null) { offGrid = true; break; }
        if (spec.dead.has(target)) { onDead = true; break; }
        absolute.push(target);
      }
      // A shape is one rigid piece, so a stray cell is not dropped on its own --
      // that could silently disconnect the rest. The whole shape goes.
      if (offGrid) {
        issues.push(`block at ${at(cell)} dropped -- part of it is outside the ${cols}x${rows} grid`);
        continue;
      }
      if (onDead) {
        issues.push(`block at ${at(cell)} dropped -- part of it sits on a cell that is switched off`);
        continue;
      }

      const free = [...new Set(absolute)].filter((c) => {
        const taken = occupant.get(c);
        if (!taken) return true;
        issues.push(`block at ${at(cell)} lost cell ${at(c)} -- already occupied by ${taken}`);
        return false;
      });
      if (free.length === 0) {
        issues.push(`block at ${at(cell)} dropped -- every cell was already occupied`);
        continue;
      }

      const parts = connectedComponents(cols, rows, new Set(free));
      if (parts.length > 1) {
        issues.push(`block at ${at(cell)} is not one connected piece -- split into ${parts.length}`);
      }
      for (const part of parts) claim([...part], spec.shapes);
      continue;
    }

    const taken = occupant.get(cell);
    if (taken) {
      issues.push(`${el.type} at ${at(cell)} dropped -- already occupied by ${taken}`);
      continue;
    }

    switch (el.type) {
      case 'wall': spec.walls.add(cell); occupant.set(cell, 'wall'); break;
      case 'bee': spec.bees.add(cell); occupant.set(cell, 'bee'); break;
      case 'gridDog': spec.gridDogs.push(cell); occupant.set(cell, 'gridDog'); break;
      default:
        issues.push(`unknown element type "${el.type}" dropped`);
    }
  }

  // Editions 1 and 2 only: a tag covered every cell painted with it, connected
  // or not. The connected runs within it are the actual groups.
  if (tagged.length) {
    const byTag = new Map<string, Set<number>>();
    for (const { cell, tag } of tagged) {
      let set = byTag.get(tag);
      if (!set) { set = new Set(); byTag.set(tag, set); }
      set.add(cell);
    }
    for (const cells of byTag.values()) {
      const parts = connectedComponents(cols, rows, cells);
      parts.sort((a, b) => Math.min(...a) - Math.min(...b));
      for (const part of parts) spec.shapes.push([...part].sort((x, y) => x - y));
    }
  }

  // A `bone` rides a block; a `gridBone` owns its cell outright. Bones are
  // resolved last so they may appear before their block in the file.
  const blockCells = new Set(spec.shapes.flat());
  for (const { cell, count, order, onGrid } of bones) {
    if (onGrid) {
      const taken = occupant.get(cell);
      if (taken) { issues.push(`gridBone at ${at(cell)} dropped -- already occupied by ${taken}`); continue; }
    } else if (!blockCells.has(cell)) {
      issues.push(`bone at ${at(cell)} dropped -- no block to ride`);
      continue;
    }

    const have = spec.bones.get(cell);
    // One tier per cell. Repeated elements stack the count; the first tier seen
    // wins, so the result does not depend on element order in the file.
    if (have) have.count += count;
    else {
      spec.bones.set(cell, { count, order });
      if (onGrid) occupant.set(cell, 'gridBone');
    }
  }

  return { spec, issues };
}

/** Total bones on the board, counting a stacked cell once per bone. */
export function countBones(spec: LevelSpec): number {
  let n = 0;
  for (const stack of spec.bones.values()) n += stack.count;
  return n;
}

export function countDogs(spec: LevelSpec): number {
  return spec.queues.reduce((n, q) => n + q.count, 0) + spec.gridDogs.length;
}

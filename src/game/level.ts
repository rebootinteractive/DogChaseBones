import type { LevelData, GameElement } from '../shared/types';
import { idx, inBounds, isDir, type Dir } from './cells';

// ---------------------------------------------------------------------------
// Level element schema (GameElement.x / .y are integer CELL coordinates here,
// not normalized stage coords -- the camera fits the grid dynamically, so a
// normalized position would be meaningless).
//
//   { type: 'dead',  x, y }                     cell switched off; splits islands
//   { type: 'wall',  x, y }                     static, unmovable, blocks everything
//   { type: 'bee',   x, y }                     fixed; poisons every cell it can reach
//   { type: 'block', x, y, group }              one unit block belonging to `group`
//   { type: 'bone',  x, y, count? }             rides the block unit in the same cell.
//                                               count defaults to 1 and stacks, so
//                                               repeated bone elements also add up.
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
 *        Bones carry an optional `count`; absent means one.
 */
export const SCHEMA_VERSION = 1;

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

export interface BlockUnit {
  cell: number;
  group: string;
  /** Dormant in v1 -- reserved for colour-matched dogs and bones. */
  colorKey?: string;
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
  units: BlockUnit[];
  /** Every bone on the board, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
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

export function parseLevel(level: LevelData): ParseResult {
  const meta = (level.meta ?? {}) as Record<string, unknown>;
  const cols = clampDim(meta.cols, DEFAULT_COLS);
  const rows = clampDim(meta.rows, DEFAULT_ROWS);
  const timeRaw = num(meta.timeLimit);
  const timeLimit = timeRaw !== null && timeRaw > 0 ? Math.round(timeRaw) : DEFAULT_TIME_LIMIT;

  // Absent means edition 1 -- levels authored before the field existed really
  // are edition 1. A newer edition is refused loudly rather than guessed at.
  const schemaRaw = num(meta.schema);
  const schema = schemaRaw !== null && schemaRaw >= 1 ? Math.round(schemaRaw) : SCHEMA_VERSION;

  const spec: LevelSpec = {
    schema, cols, rows, timeLimit,
    dead: new Set(), walls: new Set(), bees: new Set(), units: [], bones: new Map(), queues: [],
  };
  const issues: string[] = [];

  if (schema > SCHEMA_VERSION) {
    issues.push(
      `level is edition ${schema}; this build understands up to ${SCHEMA_VERSION}. ` +
      'It was made with a newer editor -- update before opening it.',
    );
  }

  // One occupant per cell: dead / wall / bee / block are mutually exclusive.
  const occupant = new Map<number, string>();
  const bones: Array<{ cell: number; count: number }> = [];
  let queueSeq = 0;

  const cellOf = (el: GameElement): number | null => {
    const c = num(el.x);
    const r = num(el.y);
    if (c === null || r === null) return null;
    const ci = Math.round(c);
    const ri = Math.round(r);
    if (!inBounds(cols, rows, ci, ri)) return null;
    return idx(cols, ci, ri);
  };

  for (const el of level.elements) {
    const cell = cellOf(el);
    if (cell === null) {
      issues.push(`${el.type} at (${String(el.x)}, ${String(el.y)}) is outside the ${cols}x${rows} grid`);
      continue;
    }

    if (el.type === 'bone') {
      const raw = num(el.count);
      bones.push({ cell, count: Math.max(1, Math.round(raw ?? 1)) });
      continue;
    }

    if (el.type === 'queue') {
      const dir = isDir(el.dir) ? el.dir : 'up';
      const rawCount = num(el.count);
      const count = Math.max(1, Math.round(rawCount ?? 1));
      spec.queues.push({ id: `q${queueSeq++}`, cell, dir, count });
      continue;
    }

    const taken = occupant.get(cell);
    if (taken) {
      issues.push(`${el.type} at cell ${cell} dropped -- already occupied by ${taken}`);
      continue;
    }

    switch (el.type) {
      case 'dead': spec.dead.add(cell); occupant.set(cell, 'dead'); break;
      case 'wall': spec.walls.add(cell); occupant.set(cell, 'wall'); break;
      case 'bee': spec.bees.add(cell); occupant.set(cell, 'bee'); break;
      case 'block': {
        const group = typeof el.group === 'string' && el.group ? el.group : `g-${cell}`;
        const unit: BlockUnit = { cell, group };
        if (typeof el.colorKey === 'string') unit.colorKey = el.colorKey;
        spec.units.push(unit);
        occupant.set(cell, 'block');
        break;
      }
      default:
        issues.push(`unknown element type "${el.type}" dropped`);
    }
  }

  // Bones ride block units. A bone with no host is not representable yet --
  // free-standing bones arrive as their own element type.
  const blockCells = new Set(spec.units.map((u) => u.cell));
  for (const { cell, count } of bones) {
    if (!blockCells.has(cell)) {
      issues.push(`bone at cell ${cell} dropped -- no block unit to ride`);
      continue;
    }
    const have = spec.bones.get(cell);
    if (have) have.count += count;
    else spec.bones.set(cell, { count, order: 1 });
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
  return spec.queues.reduce((n, q) => n + q.count, 0);
}

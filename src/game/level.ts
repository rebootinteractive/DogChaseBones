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
//   { type: 'bone',  x, y }                     rides the block unit in the same cell
//   { type: 'queue', x, y, dir, count }         entry cell; dogs line up towards `dir`
//
// meta: { cols, rows, timeLimit }
// ---------------------------------------------------------------------------

export const DEFAULT_COLS = 6;
export const DEFAULT_ROWS = 10;
export const DEFAULT_TIME_LIMIT = 120;
export const MIN_DIM = 2;
export const MAX_DIM = 14;

export interface BlockUnit {
  cell: number;
  group: string;
  bone: boolean;
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
  cols: number;
  rows: number;
  timeLimit: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  units: BlockUnit[];
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

  const spec: LevelSpec = {
    cols, rows, timeLimit,
    dead: new Set(), walls: new Set(), bees: new Set(), units: [], queues: [],
  };
  const issues: string[] = [];

  // One occupant per cell: dead / wall / bee / block are mutually exclusive.
  const occupant = new Map<number, string>();
  const unitAt = new Map<number, BlockUnit>();
  const bones: number[] = [];
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

    if (el.type === 'bone') { bones.push(cell); continue; }

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
        const unit: BlockUnit = { cell, group, bone: false };
        if (typeof el.colorKey === 'string') unit.colorKey = el.colorKey;
        spec.units.push(unit);
        unitAt.set(cell, unit);
        occupant.set(cell, 'block');
        break;
      }
      default:
        issues.push(`unknown element type "${el.type}" dropped`);
    }
  }

  // Bones ride block units. A bone with no host is not representable at runtime.
  for (const cell of bones) {
    const host = unitAt.get(cell);
    if (!host) { issues.push(`bone at cell ${cell} dropped -- no block unit to ride`); continue; }
    host.bone = true;
  }

  return { spec, issues };
}

export function countBones(spec: LevelSpec): number {
  return spec.units.reduce((n, u) => n + (u.bone ? 1 : 0), 0);
}

export function countDogs(spec: LevelSpec): number {
  return spec.queues.reduce((n, q) => n + q.count, 0);
}

import type { LevelData, GameElement } from '../shared/types';
import type { LevelSpec } from '../game/level';
import { colOf, rowOf } from '../game/cells';

export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'level';
}

function isElement(v: unknown): v is GameElement {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.x === 'number' && typeof e.y === 'number';
}

export function validateLevelData(v: unknown): v is LevelData {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.prototype === 'string' &&
    Array.isArray(l.elements) &&
    l.elements.every(isElement)
  );
}

/**
 * The canonical `block` element for one group's cells.
 *
 * The anchor is the group's first cell in reading order, so `cells` always
 * opens with [0,0], every dy is >= 0, and dx is negative only on a lower row.
 * One shape in one position therefore has exactly one encoding -- which is what
 * makes a diff small and a round-trip testable. The editor and the migration
 * both call this, so there is only ever one encoder to keep honest.
 */
export function blockElement(cols: number, cells: Iterable<number>): GameElement {
  const sorted = [...cells].sort((a, b) => a - b);
  const ax = colOf(cols, sorted[0]);
  const ay = rowOf(cols, sorted[0]);
  return {
    type: 'block',
    x: ax,
    y: ay,
    cells: sorted.map((c) => [colOf(cols, c) - ax, rowOf(cols, c) - ay]),
  };
}

/**
 * A parsed level written back out as elements. Used to convert older editions
 * to the current one; the editor builds its own from live state.
 */
export function specToElements(spec: LevelSpec): GameElement[] {
  const els: GameElement[] = [];
  const at = (type: string, cell: number, extra: Record<string, unknown> = {}) =>
    els.push({ type, x: colOf(spec.cols, cell), y: rowOf(spec.cols, cell), ...extra });

  for (const cell of spec.dead) at('dead', cell);
  for (const cell of spec.walls) at('wall', cell);
  for (const cell of spec.bees) at('bee', cell);
  for (const cells of spec.shapes) els.push(blockElement(spec.cols, cells));

  const blockCells = new Set(spec.shapes.flat());
  for (const [cell, stack] of spec.bones) {
    at(blockCells.has(cell) ? 'bone' : 'gridBone', cell, { count: stack.count, order: stack.order });
  }
  for (const cell of spec.gridDogs) at('gridDog', cell);
  for (const q of spec.queues) at('queue', q.cell, { dir: q.dir, count: q.count });
  return els;
}

/**
 * A level as JSON a human can read in a diff.
 *
 * `JSON.stringify(level, null, 2)` puts every coordinate of every `cells` list
 * on its own line, so a four-cell shape costs seventeen lines and a real change
 * is impossible to spot. Pairs are kept inline instead; nothing else about the
 * output differs, and it still parses as ordinary JSON.
 */
export function formatLevelJson(level: LevelData): string {
  const json = JSON.stringify(level, null, 2);
  // Collapse any array whose entries are all plain numbers -- that is exactly
  // the [dx, dy] pairs and the lists of them, and nothing else in a level.
  return json.replace(/\[\s*((?:-?\d+\s*,\s*)*-?\d+)\s*\]/g, (_m, body: string) =>
    `[${body.split(',').map((n) => n.trim()).join(', ')}]`,
  );
}

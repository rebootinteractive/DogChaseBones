import type { LevelData, GameElement } from '../src/shared/types';
import type { Dir } from '../src/game/cells';
import { parseLevel } from '../src/game/level';
import { createBoard } from '../src/game/board';
import type { BoardState } from '../src/game/board';

/**
 * ASCII boards keep the puzzle cases readable.
 *   '.' empty   '#' wall   'X' dead cell   '*' bee
 *   'a'..'z'    a block unit of that group
 *   'A'..'Z'    the same, carrying a bone
 */
export function elementsFromAscii(rows: string[]): GameElement[] {
  const els: GameElement[] = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      if (ch === '#') { els.push({ type: 'wall', x: c, y: r }); return; }
      if (ch === 'X') { els.push({ type: 'dead', x: c, y: r }); return; }
      if (ch === '*') { els.push({ type: 'bee', x: c, y: r }); return; }
      if (/[a-zA-Z]/.test(ch)) {
        els.push({ type: 'block', x: c, y: r, group: ch.toLowerCase() });
        if (ch === ch.toUpperCase()) els.push({ type: 'bone', x: c, y: r });
        return;
      }
      throw new Error(`unknown board char "${ch}"`);
    });
  });
  return els;
}

export interface QueueInput { c: number; r: number; dir: Dir; count?: number }

/**
 * A parallel grid of digits giving each bone's activation tier. '.' means the
 * default, tier 1. Kept as its own grid so the board itself stays readable.
 */
export type TierRows = string[];

function applyTiers(els: GameElement[], tiers?: TierRows) {
  if (!tiers) return els;
  for (const el of els) {
    if (el.type !== 'bone' && el.type !== 'gridBone') continue;
    const ch = tiers[el.y as number]?.[el.x as number];
    if (ch && ch !== '.') el.order = Number(ch);
  }
  return els;
}

export function levelFromAscii(
  rows: string[],
  queues: QueueInput[] = [],
  meta: Record<string, unknown> = {},
  tiers?: TierRows,
): LevelData {
  return {
    id: 'test',
    name: 'Test',
    prototype: 'dog-chase-bones',
    elements: [
      ...applyTiers(elementsFromAscii(rows), tiers),
      ...queues.map((q) => ({ type: 'queue', x: q.c, y: q.r, dir: q.dir, count: q.count ?? 1 })),
    ],
    meta: { cols: rows[0].length, rows: rows.length, ...meta },
  };
}

export function boardFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows): BoardState {
  return createBoard(parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec);
}

export function specFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows) {
  return parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec;
}

/** Render occupancy back to ASCII so assertions can compare whole boards. */
export function toAscii(state: BoardState): string[] {
  const out: string[] = [];
  for (let r = 0; r < state.rows; r++) {
    let line = '';
    for (let c = 0; c < state.cols; c++) {
      const i = r * state.cols + c;
      const unit = state.units.get(i);
      if (unit) line += state.bones.has(i) ? unit.group.toUpperCase()[0] : unit.group[0];
      else if (state.dead.has(i)) line += 'X';
      else if (state.walls.has(i)) line += '#';
      else if (state.bees.has(i)) line += '*';
      else line += '.';
    }
    out.push(line);
  }
  return out;
}

export const cellIdx = (cols: number, c: number, r: number) => r * cols + c;

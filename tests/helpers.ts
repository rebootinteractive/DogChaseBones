import type { LevelData, GameElement } from '../src/shared/types';
import type { Dir } from '../src/game/cells';
import { connectedComponents } from '../src/game/cells';
import { parseLevel, SCHEMA_VERSION } from '../src/game/level';
import { createBoard } from '../src/game/board';
import type { BlockGroup, BoardState } from '../src/game/board';
import { blockElement } from '../src/levels/serialize';

/**
 * ASCII boards keep the puzzle cases readable.
 *   '.' empty   '#' wall   'X' dead cell   '*' bee
 *   '+' a bone sitting on the grid   '@' a dog standing on the grid
 *   'a'..'z'    a block cell painted with that letter
 *   'A'..'Z'    the same, carrying a bone
 *
 * The letter is authoring shorthand, not a group id -- the format has none.
 * Cells sharing a letter and touching are one shape; two lumps of the same
 * letter that do not touch are two shapes, which is what the letters are for.
 * Shapes come out in letter order, then in reading order within a letter, so
 * `toAscii` can name them back deterministically.
 */
export function elementsFromAscii(rows: string[]): GameElement[] {
  const cols = rows[0].length;
  const els: GameElement[] = [];
  const painted = new Map<string, Set<number>>();

  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const cell = r * cols + c;
      if (ch === '.') return;
      if (ch === '#') { els.push({ type: 'wall', x: c, y: r }); return; }
      if (ch === 'X') { els.push({ type: 'dead', x: c, y: r }); return; }
      if (ch === '*') { els.push({ type: 'bee', x: c, y: r }); return; }
      if (ch === '+') { els.push({ type: 'gridBone', x: c, y: r }); return; }
      if (ch === '@') { els.push({ type: 'gridDog', x: c, y: r }); return; }
      if (/[a-zA-Z]/.test(ch)) {
        const letter = ch.toLowerCase();
        let set = painted.get(letter);
        if (!set) { set = new Set(); painted.set(letter, set); }
        set.add(cell);
        if (ch === ch.toUpperCase()) els.push({ type: 'bone', x: c, y: r });
        return;
      }
      throw new Error(`unknown board char "${ch}"`);
    });
  });

  const shapes: number[][] = [];
  for (const letter of [...painted.keys()].sort()) {
    const parts = connectedComponents(cols, rows.length, painted.get(letter)!);
    parts.sort((a, b) => Math.min(...a) - Math.min(...b));
    for (const part of parts) shapes.push([...part].sort((x, y) => x - y));
  }
  // Blocks first: a bone element is dropped unless something is under it.
  return [...shapes.map((cells) => blockElement(cols, cells)), ...els];
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
    meta: { schema: SCHEMA_VERSION, cols: rows[0].length, rows: rows.length, ...meta },
  };
}

export function boardFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows): BoardState {
  return createBoard(parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec);
}

export function specFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows) {
  return parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec;
}

/**
 * Render occupancy back to ASCII so assertions can compare whole boards.
 *
 * A group has no name, so one is made here from its position in `state.groups`:
 * 'a' for the first, 'b' for the second. That means the letters say exactly how
 * many groups there are and which cells belong together -- a board that reads
 * 'a.b' is two groups where 'a.a' would be one.
 */
export function toAscii(state: BoardState): string[] {
  const letter = new Map<BlockGroup, string>();
  state.groups.forEach((g, n) => letter.set(g, String.fromCharCode(97 + (n % 26))));

  const out: string[] = [];
  for (let r = 0; r < state.rows; r++) {
    let line = '';
    for (let c = 0; c < state.cols; c++) {
      const i = r * state.cols + c;
      const group = state.unitAt.get(i);
      if (group) {
        const ch = letter.get(group) ?? '?';
        line += state.bones.has(i) ? ch.toUpperCase() : ch;
      }
      else if (state.bones.has(i)) line += '+';
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

/**
 * The group holding `cell`. Groups have no ids, so a test that wants to move
 * one points at a cell it occupies -- which stays correct however the piece has
 * been split or slid since.
 */
export function groupAt(state: BoardState, cell: number): BlockGroup {
  const g = state.unitAt.get(cell);
  if (!g) throw new Error(`no block at cell ${cell}`);
  return g;
}

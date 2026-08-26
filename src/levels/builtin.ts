import type { GameElement, LevelData } from '../shared/types';
import { PROTOTYPE } from '../config';
import { SCHEMA_VERSION } from '../game/level';

/**
 * Baseline levels, authored as ASCII so the layout is readable in the diff.
 *   '.' empty   '#' wall   'X' cell switched off   '*' bee
 *   'a'..'z'    a block unit belonging to that group
 *   'A'..'Z'    the same unit, carrying a bone
 */
function fromAscii(rows: string[]): GameElement[] {
  const els: GameElement[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (ch === '#') return void els.push({ type: 'wall', x, y });
      if (ch === 'X') return void els.push({ type: 'dead', x, y });
      if (ch === '*') return void els.push({ type: 'bee', x, y });
      els.push({ type: 'block', x, y, group: ch.toLowerCase() });
      if (ch === ch.toUpperCase()) els.push({ type: 'bone', x, y });
    });
  });
  return els;
}

interface QueueDef { x: number; y: number; dir: 'up' | 'right' | 'down' | 'left'; count: number }

function level(
  id: string, name: string, rows: string[], queues: QueueDef[], timeLimit: number,
): LevelData {
  return {
    id, name, prototype: PROTOTYPE,
    elements: [...fromAscii(rows), ...queues.map((q) => ({ type: 'queue', ...q }))],
    meta: { schema: SCHEMA_VERSION, cols: rows[0].length, rows: rows.length, timeLimit },
  };
}

// 1 - One slide. The dog cannot even step onto the board until the block group
//     is moved off its entry cell.
const l1 = level('b1-first-bone', 'First Bone', [
  '.....',
  'a..B.',
  'a....',
  '.....',
], [{ x: 0, y: 1, dir: 'left', count: 1 }], 90);

// 2 - Two queues, walls, and a bone group that splits when its middle unit is
//     eaten. The two bottom bones are free; the walled-in one forces a slide.
const l2 = level('b2-tight-squeeze', 'Tight Squeeze', [
  '......',
  '......',
  '......',
  '..#...',
  '.bBb..',
  '..#...',
  '....DD',
], [
  { x: 0, y: 0, dir: 'up', count: 1 },
  { x: 5, y: 5, dir: 'right', count: 2 },
], 150);

// 3 - The bee. It floods up through the gap in the wall and poisons the whole
//     top room, so the dog refuses to move until the gap is plugged.
const l3 = level('b3-sealed-room', 'Sealed Room', [
  '..AA..',
  '....p.',
  '###.##',
  '......',
  '..*...',
  '......',
], [{ x: 0, y: 0, dir: 'up', count: 2 }], 150);

export const BUILTIN_LEVELS: LevelData[] = [l1, l2, l3];

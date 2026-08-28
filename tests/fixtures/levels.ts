import type { LevelData } from '../../src/shared/types';
import { PROTOTYPE } from '../../src/config';
import { SCHEMA_VERSION } from '../../src/game/level';
import { elementsFromAscii } from '../helpers';

/**
 * The three levels this prototype shipped with, kept as fixtures after they were
 * removed from the game. They are the engine's only end-to-end coverage: each is
 * played to a win through the real slide/resolve/eat/split path, so they still
 * earn their place even though no player will ever see them.
 *
 * Authored as ASCII so the layout is readable in the diff -- see
 * `elementsFromAscii` in tests/helpers.ts for the characters.
 */
interface QueueDef { x: number; y: number; dir: 'up' | 'right' | 'down' | 'left'; count: number }

function level(
  id: string, name: string, rows: string[], queues: QueueDef[], timeLimit: number,
): LevelData {
  return {
    id, name, prototype: PROTOTYPE,
    elements: [...elementsFromAscii(rows), ...queues.map((q) => ({ type: 'queue', ...q }))],
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

export const FIXTURE_LEVELS: LevelData[] = [l1, l2, l3];

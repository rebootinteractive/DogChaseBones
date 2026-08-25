import { describe, it, expect } from 'vitest';
import { countBones, countDogs, parseLevel, DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_TIME_LIMIT } from '../src/game/level';
import { levelFromAscii } from './helpers';

const level = (elements: Record<string, unknown>[], meta?: Record<string, unknown>) => ({
  id: 'x', name: 'X', prototype: 'dog-chase-bones',
  elements: elements as never, ...(meta ? { meta } : {}),
});

describe('parseLevel', () => {
  it('reads grid size and time limit from meta', () => {
    const { spec } = parseLevel(level([], { cols: 7, rows: 9, timeLimit: 45 }));
    expect(spec.cols).toBe(7);
    expect(spec.rows).toBe(9);
    expect(spec.timeLimit).toBe(45);
  });

  it('falls back to defaults when meta is missing or nonsense', () => {
    const { spec } = parseLevel(level([], { timeLimit: -5 }));
    expect(spec.cols).toBe(DEFAULT_COLS);
    expect(spec.rows).toBe(DEFAULT_ROWS);
    expect(spec.timeLimit).toBe(DEFAULT_TIME_LIMIT);
  });

  it('groups block units by their group field', () => {
    const { spec } = parseLevel(levelFromAscii(['aab.', '....']));
    expect(spec.units.filter((u) => u.group === 'a')).toHaveLength(2);
    expect(spec.units.filter((u) => u.group === 'b')).toHaveLength(1);
  });

  it('attaches a bone to the unit sharing its cell', () => {
    const { spec } = parseLevel(levelFromAscii(['aA..', '....']));
    expect(countBones(spec)).toBe(1);
    expect(spec.units.find((u) => u.bone)!.cell).toBe(1);
  });

  it('drops an orphan bone and says so', () => {
    const { spec, issues } = parseLevel(level([{ type: 'bone', x: 1, y: 1 }], { cols: 4, rows: 4 }));
    expect(countBones(spec)).toBe(0);
    expect(issues.join(' ')).toMatch(/no block unit to ride/);
  });

  it('drops elements outside the grid and says so', () => {
    const { spec, issues } = parseLevel(level([{ type: 'wall', x: 9, y: 0 }], { cols: 4, rows: 4 }));
    expect(spec.walls.size).toBe(0);
    expect(issues.join(' ')).toMatch(/outside the 4x4 grid/);
  });

  it('keeps the first occupant when two elements claim one cell', () => {
    const { spec, issues } = parseLevel(
      level([{ type: 'wall', x: 0, y: 0 }, { type: 'bee', x: 0, y: 0 }], { cols: 4, rows: 4 }),
    );
    expect(spec.walls.has(0)).toBe(true);
    expect(spec.bees.size).toBe(0);
    expect(issues.join(' ')).toMatch(/already occupied by wall/);
  });

  it('gives each queue a stable id and a sane count', () => {
    const { spec } = parseLevel(
      level([
        { type: 'queue', x: 0, y: 0, dir: 'up', count: 3 },
        { type: 'queue', x: 1, y: 0, dir: 'nonsense', count: 0 },
      ], { cols: 4, rows: 4 }),
    );
    expect(spec.queues.map((q) => q.id)).toEqual(['q0', 'q1']);
    expect(spec.queues[1].dir).toBe('up');   // bad dir falls back
    expect(spec.queues[1].count).toBe(1);    // count is clamped to at least one
    expect(countDogs(spec)).toBe(4);
  });

  it('rejects an unknown element type', () => {
    const { issues } = parseLevel(level([{ type: 'banana', x: 0, y: 0 }], { cols: 4, rows: 4 }));
    expect(issues.join(' ')).toMatch(/unknown element type/);
  });
});

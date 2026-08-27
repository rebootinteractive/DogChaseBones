import { describe, it, expect } from 'vitest';
import { countBones, countDogs, parseLevel, DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_TIME_LIMIT, SCHEMA_VERSION } from '../src/game/level';
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
    expect(spec.bones.get(1)).toEqual({ count: 1, order: 1 });
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

describe('stacked bones', () => {
  const stack = (count: unknown) => parseLevel(level([
    { type: 'block', x: 0, y: 0, group: 'a' },
    { type: 'bone', x: 0, y: 0, count },
  ], { cols: 4, rows: 4 })).spec;

  it('reads a count off the bone element', () => {
    expect(stack(3).bones.get(0)!.count).toBe(3);
    expect(countBones(stack(3))).toBe(3);
  });

  it('defaults to one and never goes below it', () => {
    expect(stack(undefined).bones.get(0)!.count).toBe(1);
    expect(stack(0).bones.get(0)!.count).toBe(1);
    expect(stack(-4).bones.get(0)!.count).toBe(1);
  });

  it('adds up repeated bone elements on one cell', () => {
    const { spec } = parseLevel(level([
      { type: 'block', x: 0, y: 0, group: 'a' },
      { type: 'bone', x: 0, y: 0 },
      { type: 'bone', x: 0, y: 0, count: 2 },
    ], { cols: 4, rows: 4 }));
    expect(spec.bones.get(0)!.count).toBe(3);
  });

  it('counts a stack once per bone when weighing dogs against bones', () => {
    const { spec } = parseLevel(level([
      { type: 'block', x: 0, y: 0, group: 'a' },
      { type: 'bone', x: 0, y: 0, count: 3 },
      { type: 'queue', x: 0, y: 1, dir: 'left', count: 3 },
    ], { cols: 4, rows: 4 }));
    expect(countBones(spec)).toBe(3);
    expect(countDogs(spec)).toBe(3);
  });
});

describe('format edition', () => {
  it('stamps edition 1 on a level that predates the field', () => {
    const { spec, issues } = parseLevel(level([], { cols: 4, rows: 4 }));
    expect(spec.schema).toBe(1);
    expect(issues).toEqual([]);
  });

  it('reads the edition a level declares', () => {
    expect(parseLevel(level([], { schema: 1, cols: 4, rows: 4 })).spec.schema).toBe(1);
  });

  it('refuses a level from a newer editor loudly instead of guessing', () => {
    const { spec, issues } = parseLevel(level([], { schema: SCHEMA_VERSION + 1, cols: 4, rows: 4 }));
    expect(spec.schema).toBe(SCHEMA_VERSION + 1);
    expect(issues.join(' ')).toMatch(/newer editor/);
  });

  it('treats a nonsense edition as the current one', () => {
    expect(parseLevel(level([], { schema: 'banana', cols: 4, rows: 4 })).spec.schema).toBe(SCHEMA_VERSION);
    expect(parseLevel(level([], { schema: 0, cols: 4, rows: 4 })).spec.schema).toBe(SCHEMA_VERSION);
  });
});

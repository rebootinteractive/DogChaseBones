import { describe, it, expect } from 'vitest';
import { parseLevel, SCHEMA_VERSION } from '../src/game/level';
import { blockElement, specToElements } from '../src/levels/serialize';
import { createBoard, destroyCell } from '../src/game/board';
import type { LevelData, GameElement } from '../src/shared/types';

/**
 * Edition 3: a block element is a whole group -- an anchor plus a list of cell
 * offsets -- rather than one cell tagged with a group name.
 *
 * The tag was the bug. It looked like an identity and was not: two lumps
 * painted with one tag were always two separate pieces, and every reader had to
 * know to split them. A shape that declares its own cells cannot be misread,
 * and there is no id left to go stale when a piece splits mid-play.
 */

const level = (elements: GameElement[], meta: Record<string, unknown> = {}): LevelData => ({
  id: 'test', name: 'Test', prototype: 'dog-chase-bones',
  elements,
  meta: { schema: SCHEMA_VERSION, cols: 4, rows: 4, timeLimit: 60, ...meta },
});

const shape = (x: number, y: number, cells: number[][]): GameElement =>
  ({ type: 'block', x, y, cells });

describe('reading a shape', () => {
  it('places every cell relative to the anchor', () => {
    const { spec, issues } = parseLevel(level([shape(1, 1, [[0, 0], [1, 0], [1, 1]])]));
    expect(issues).toEqual([]);
    expect(spec.shapes).toEqual([[5, 6, 10]]);
  });

  it('makes one group per element, however they are painted', () => {
    // Two elements that happen to touch stay two groups -- that is the whole
    // point of a shape declaring its own cells.
    const { spec } = parseLevel(level([
      shape(0, 0, [[0, 0], [1, 0]]),
      shape(2, 0, [[0, 0], [1, 0]]),
    ]));
    expect(spec.shapes).toEqual([[0, 1], [2, 3]]);
    const board = createBoard(spec);
    expect(board.groups).toHaveLength(2);
    expect(board.unitAt.get(1)).not.toBe(board.unitAt.get(2));
  });

  it('deduplicates a repeated offset', () => {
    const { spec } = parseLevel(level([shape(0, 0, [[0, 0], [1, 0], [1, 0]])]));
    expect(spec.shapes).toEqual([[0, 1]]);
  });
});

describe('a shape the parser cannot take at face value', () => {
  it('drops one with no cells list', () => {
    const { spec, issues } = parseLevel(level([{ type: 'block', x: 0, y: 0 }]));
    expect(spec.shapes).toEqual([]);
    expect(issues[0]).toMatch(/no cells list/);
  });

  it('drops one with an empty cells list', () => {
    const { spec, issues } = parseLevel(level([shape(0, 0, [])]));
    expect(spec.shapes).toEqual([]);
    expect(issues[0]).toMatch(/empty cells list/);
  });

  it('drops the whole shape when one cell is off the grid', () => {
    // Not just the stray cell: dropping that could silently disconnect the
    // rest, and a shape half-loaded is worse than one refused.
    const { spec, issues } = parseLevel(level([shape(3, 0, [[0, 0], [1, 0]])]));
    expect(spec.shapes).toEqual([]);
    expect(issues[0]).toMatch(/outside the 4x4 grid/);
  });

  it('drops the whole shape when one cell sits on a dead cell', () => {
    const { spec, issues } = parseLevel(level([
      shape(0, 0, [[0, 0], [1, 0]]),
      { type: 'dead', x: 1, y: 0 },
    ]));
    expect(spec.shapes).toEqual([]);
    expect(issues[0]).toMatch(/switched off/);
  });

  it('settles dead cells first, so array order cannot change the answer', () => {
    const before = parseLevel(level([
      { type: 'dead', x: 1, y: 0 },
      shape(0, 0, [[0, 0], [1, 0]]),
    ]));
    const after = parseLevel(level([
      shape(0, 0, [[0, 0], [1, 0]]),
      { type: 'dead', x: 1, y: 0 },
    ]));
    expect(before.spec.shapes).toEqual(after.spec.shapes);
  });

  it('splits a shape that is not one connected piece, and says so', () => {
    const { spec, issues } = parseLevel(level([shape(0, 0, [[0, 0], [2, 0]])]));
    expect(spec.shapes).toEqual([[0], [2]]);
    expect(issues[0]).toMatch(/not one connected piece -- split into 2/);
  });

  it('gives a contested cell to the earlier shape and keeps the rest', () => {
    const { spec, issues } = parseLevel(level([
      shape(0, 0, [[0, 0], [1, 0]]),
      shape(1, 0, [[0, 0], [1, 0]]),
    ]));
    expect(spec.shapes).toEqual([[0, 1], [2]]);
    expect(issues[0]).toMatch(/lost cell \(1, 0\)/);
  });

  it('splits the later shape when the cell it lost was its bridge', () => {
    const { spec } = parseLevel(level([
      shape(1, 0, [[0, 0]]),
      shape(0, 0, [[0, 0], [1, 0], [2, 0]]),
    ]));
    expect(spec.shapes).toEqual([[1], [0], [2]]);
  });
});

describe('canonical encoding', () => {
  it('anchors on the first cell in reading order, so [0,0] always leads', () => {
    // An L that leans left: the anchor is the top cell, and the tail below it
    // has a negative dx. dy is never negative, because the anchor is the
    // topmost cell of the topmost row.
    const el = blockElement(4, [1, 4, 5]);
    expect(el).toEqual({ type: 'block', x: 1, y: 0, cells: [[0, 0], [-1, 1], [0, 1]] });
  });

  it('encodes the same shape in the same place the same way, whatever the input order', () => {
    expect(blockElement(4, [5, 1, 4])).toEqual(blockElement(4, [1, 4, 5]));
  });

  it('survives a round trip through the parser unchanged', () => {
    const original = level([
      shape(1, 1, [[0, 0], [1, 0], [1, 1]]),
      { type: 'bone', x: 2, y: 2, count: 2, order: 3 },
      { type: 'queue', x: 0, y: 0, dir: 'left', count: 1 },
    ]);
    const once = specToElements(parseLevel(original).spec);
    const twice = specToElements(parseLevel({ ...original, elements: once }).spec);
    expect(twice).toEqual(once);
  });
});

describe('older editions still open', () => {
  it('splits a tag covering two lumps into the two groups it always was', () => {
    // This is the level shape that made the tag dangerous: one name, two
    // pieces. Reading it now gives what the game always actually did.
    const old = level([
      { type: 'block', x: 0, y: 0, group: 'g1' },
      { type: 'block', x: 1, y: 0, group: 'g1' },
      { type: 'block', x: 3, y: 0, group: 'g1' },
    ], { schema: 1 });
    const { spec, issues } = parseLevel(old);
    expect(issues).toEqual([]);
    expect(spec.shapes).toEqual([[0, 1], [3]]);
  });

  it('reads to exactly the same board as its edition-3 rewrite', () => {
    const old = level([
      { type: 'block', x: 0, y: 0, group: 'a' },
      { type: 'block', x: 1, y: 0, group: 'a' },
      { type: 'block', x: 3, y: 0, group: 'a' },
      { type: 'bone', x: 1, y: 0, count: 2, order: 2 },
      { type: 'queue', x: 0, y: 3, dir: 'down', count: 1 },
    ], { schema: 2 });
    const { spec } = parseLevel(old);
    const rewritten = parseLevel({ ...old, elements: specToElements(spec), meta: { ...old.meta, schema: 3 } }).spec;
    expect(rewritten.shapes).toEqual(spec.shapes);
    expect([...rewritten.bones]).toEqual([...spec.bones]);
    expect(rewritten.queues).toEqual(spec.queues);
  });

  it('refuses an edition-3 block that still uses a tag', () => {
    // Not a silent single cell: a build reading edition 3 must not quietly
    // half-load a file written by something it does not understand.
    const { spec, issues } = parseLevel(level([{ type: 'block', x: 0, y: 0, group: 'a' }]));
    expect(spec.shapes).toEqual([]);
    expect(issues[0]).toMatch(/no cells list/);
  });
});

describe('splitting during play', () => {
  it('keeps the original object and pushes one new group per extra part', () => {
    const { spec } = parseLevel(level([shape(0, 0, [[0, 0], [1, 0], [2, 0]])]));
    const board = createBoard(spec);
    const original = board.groups[0];

    const parts = destroyCell(board, 1);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(original);            // one part stays with the object
    expect(board.groups).toHaveLength(2);
    expect([...original.cells]).toEqual([0]);
    expect(board.unitAt.get(2)).toBe(parts[1]);
    expect(board.unitAt.get(2)).not.toBe(original);
  });

  it('splits into three when a cross loses its centre', () => {
    const { spec } = parseLevel(level([shape(1, 0, [[0, 0], [-1, 1], [0, 1], [1, 1], [0, 2]])]));
    const board = createBoard(spec);
    expect(destroyCell(board, 5)).toHaveLength(4);
    expect(board.groups).toHaveLength(4);
  });
});

import { describe, it, expect } from 'vitest';
import { exportFileName, exportPayload } from '../src/levels/exportLevel';
import { validateLevelData } from '../src/levels/serialize';
import type { LevelData } from '../src/shared/types';

const level = (over: Partial<LevelData> = {}): LevelData => ({
  id: 'x', name: 'Tight Squeeze', prototype: 'dog-chase-bones',
  elements: [{ type: 'block', x: 0, y: 0, group: 'g1' }],
  ...over,
});

describe('exportFileName', () => {
  it('numbers files in menu order and slugifies the name', () => {
    expect(exportFileName(level(), 0)).toBe('01-tight-squeeze.json');
    expect(exportFileName(level(), 11)).toBe('12-tight-squeeze.json');
  });

  it('keeps two levels with the same name apart', () => {
    expect(exportFileName(level(), 0)).not.toBe(exportFileName(level(), 1));
  });

  it('falls back to a usable name when the title has no letters', () => {
    expect(exportFileName(level({ name: '!!!' }), 0)).toBe('01-level.json');
  });
});

describe('exportPayload', () => {
  it('strips the draft flag so a committed level is not badged forever', () => {
    const out = exportPayload(level({ meta: { cols: 6, rows: 7, timeLimit: 90, draft: true } }));
    expect(out.meta).toEqual({ cols: 6, rows: 7, timeLimit: 90 });
  });

  it('drops meta entirely when the draft flag was all it held', () => {
    expect(exportPayload(level({ meta: { draft: true } })).meta).toBeUndefined();
  });

  it('leaves a level with no meta alone', () => {
    expect(exportPayload(level()).meta).toBeUndefined();
  });

  it('keeps the content the level needs to load', () => {
    const out = exportPayload(level({ meta: { cols: 5, rows: 4, timeLimit: 90 } }));
    expect(out).toMatchObject({ id: 'x', name: 'Tight Squeeze', prototype: 'dog-chase-bones' });
    expect(out.elements).toHaveLength(1);
  });

  it('produces something the level loader accepts back', () => {
    const out = exportPayload(level({ meta: { cols: 5, rows: 4, timeLimit: 90, draft: true } }));
    expect(validateLevelData(JSON.parse(JSON.stringify(out)))).toBe(true);
  });
});

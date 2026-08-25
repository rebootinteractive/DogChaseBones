import { describe, it, expect, vi } from 'vitest';
import { LevelStore } from '../src/levels/store';
import type { LevelData, LevelsBackend } from '../src/shared/types';

const L = (id: string, name: string): LevelData => ({ id, name, prototype: 'p', elements: [] });

function fakeBackend(over: Partial<LevelsBackend> = {}): LevelsBackend {
  return {
    fetch: vi.fn(async () => [] as LevelData[]),
    insert: vi.fn(async () => {}),
    ...over,
  };
}

describe('LevelStore.list', () => {
  it('merges builtin with remote', async () => {
    const backend = fakeBackend({ fetch: vi.fn(async () => [L('r1', 'Apple')]) });
    const store = new LevelStore('p', backend, [L('b1', 'B1')]);
    const out = await store.list();
    expect(out.map((l) => l.id)).toEqual(['b1', 'r1']);
  });

  it('falls back to builtin-only when fetch throws', async () => {
    const backend = fakeBackend({ fetch: vi.fn(async () => { throw new Error('offline'); }) });
    const store = new LevelStore('p', backend, [L('b1', 'B1')]);
    const out = await store.list();
    expect(out.map((l) => l.id)).toEqual(['b1']);
  });
});

describe('LevelStore.save', () => {
  it('inserts a valid level with the store prototype', async () => {
    const insert = vi.fn(async () => {});
    const store = new LevelStore('p', fakeBackend({ insert }), []);
    await store.save({ id: 'x', name: 'X', prototype: 'other', elements: [] });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ prototype: 'p' }));
  });

  it('rejects an invalid level', async () => {
    const insert = vi.fn(async () => {});
    const store = new LevelStore('p', fakeBackend({ insert }), []);
    await expect(store.save({ id: 'x' } as never)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});

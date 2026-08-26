import { describe, it, expect, vi } from 'vitest';
import { LevelStore } from '../src/levels/store';
import type { LevelData, LevelsBackend } from '../src/shared/types';

const L = (id: string, name: string, meta?: Record<string, unknown>): LevelData => ({
  id, name, prototype: 'p', elements: [], ...(meta ? { meta } : {}),
});

function fakeBackend(over: Partial<LevelsBackend> = {}): LevelsBackend {
  return {
    fetch: vi.fn(async () => [] as LevelData[]),
    insert: vi.fn(async () => {}),
    ...over,
  };
}

const store = (opts: { drafts?: LevelsBackend; published?: LevelsBackend | null; builtin?: LevelData[] } = {}) =>
  new LevelStore('p', opts.drafts ?? fakeBackend(), opts.published === undefined ? null : opts.published, opts.builtin ?? []);

describe('LevelStore.list', () => {
  it('layers builtin, then published, then drafts', async () => {
    const out = await store({
      builtin: [L('b1', 'B1')],
      published: fakeBackend({ fetch: vi.fn(async () => [L('r1', 'Apple')]) }),
      drafts: fakeBackend({ fetch: vi.fn(async () => [L('d1', 'Draft')]) }),
    }).list();
    expect(out.map((l) => l.id)).toEqual(['b1', 'r1', 'd1']);
  });

  it('lets a draft shadow the published level it is an edit of', async () => {
    const out = await store({
      builtin: [L('b1', 'Original')],
      drafts: fakeBackend({ fetch: vi.fn(async () => [L('b1', 'My edit', { draft: true })]) }),
    }).list();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('My edit');
  });

  it('works with no published backend at all', async () => {
    const out = await store({ builtin: [L('b1', 'B1')], published: null }).list();
    expect(out.map((l) => l.id)).toEqual(['b1']);
  });

  it('still returns drafts when the published fetch fails', async () => {
    const out = await store({
      builtin: [L('b1', 'B1')],
      published: fakeBackend({ fetch: vi.fn(async () => { throw new Error('offline'); }) }),
      drafts: fakeBackend({ fetch: vi.fn(async () => [L('d1', 'Draft')]) }),
    }).list();
    expect(out.map((l) => l.id)).toEqual(['b1', 'd1']);
  });

  it('still returns published levels when the drafts read fails', async () => {
    const out = await store({
      builtin: [L('b1', 'B1')],
      published: fakeBackend({ fetch: vi.fn(async () => [L('r1', 'Apple')]) }),
      drafts: fakeBackend({ fetch: vi.fn(async () => { throw new Error('storage blocked'); }) }),
    }).list();
    expect(out.map((l) => l.id)).toEqual(['b1', 'r1']);
  });
});

describe('LevelStore.saveDraft', () => {
  it('writes to the drafts backend and never to the published one', async () => {
    const drafts = fakeBackend();
    const published = fakeBackend();
    await store({ drafts, published }).saveDraft(L('x', 'X'));
    expect(drafts.insert).toHaveBeenCalledOnce();
    expect(published.insert).not.toHaveBeenCalled();
  });

  it('stays local even when a shared backend is configured', async () => {
    // The whole point: connecting Supabase must not turn Save into publish.
    const published = fakeBackend();
    await store({ published }).saveDraft(L('x', 'X'));
    expect(published.insert).not.toHaveBeenCalled();
  });

  it('stamps the store prototype', async () => {
    const drafts = fakeBackend();
    await store({ drafts }).saveDraft({ id: 'x', name: 'X', prototype: 'other', elements: [] });
    expect(drafts.insert).toHaveBeenCalledWith(expect.objectContaining({ prototype: 'p' }));
  });

  it('rejects an invalid level before it reaches the backend', async () => {
    const drafts = fakeBackend();
    await expect(store({ drafts }).saveDraft({ id: 'x' } as unknown as LevelData)).rejects.toThrow();
    expect(drafts.insert).not.toHaveBeenCalled();
  });
});

describe('LevelStore.publish', () => {
  it('writes to the published backend and never to drafts', async () => {
    const drafts = fakeBackend();
    const published = fakeBackend();
    await store({ drafts, published }).publish(L('x', 'X'));
    expect(published.insert).toHaveBeenCalledOnce();
    expect(drafts.insert).not.toHaveBeenCalled();
  });

  it('refuses when nothing is configured to publish to', async () => {
    await expect(store({ published: null }).publish(L('x', 'X'))).rejects.toThrow(/no published/);
  });
});

describe('LevelStore.canPublish', () => {
  it('reports whether levels can be shared from inside the app', () => {
    expect(store({ published: null }).canPublish).toBe(false);
    expect(store({ published: fakeBackend() }).canPublish).toBe(true);
  });
});

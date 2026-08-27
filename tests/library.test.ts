import { describe, it, expect, vi } from 'vitest';
import { LevelLibrary } from '../src/levels/library';
import type { LevelSource, SourceId } from '../src/levels/sources/types';
import type { LevelData } from '../src/shared/types';

const L = (id: string, name = id): LevelData => ({ id, name, prototype: 'p', elements: [] });

function source(
  id: SourceId,
  levels: LevelData[],
  opts: { available?: boolean; editable?: boolean; deletable?: boolean; fail?: boolean } = {},
): LevelSource {
  const s: LevelSource = {
    id,
    label: id,
    blurb: '',
    available: opts.available ?? true,
    list: vi.fn(async () => { if (opts.fail) throw new Error(`${id} is down`); return levels; }),
  };
  if (opts.editable !== false) (s as { save?: unknown }).save = vi.fn(async () => {});
  if (opts.deletable) (s as { remove?: unknown }).remove = vi.fn(async () => {});
  return s;
}

describe('LevelLibrary.available', () => {
  it('hides a source that is not available', () => {
    const lib = new LevelLibrary([
      source('local', []),
      source('repo', [], { available: false }),
      source('server', []),
    ]);
    expect(lib.available.map((s) => s.id)).toEqual(['local', 'server']);
  });
});

describe('LevelLibrary.refresh', () => {
  it('keeps each source separate instead of merging them', async () => {
    const lib = new LevelLibrary([source('local', [L('a')]), source('server', [L('a'), L('b')])]);
    const out = await lib.refresh();
    expect(out.map((r) => [r.source.id, r.levels.map((l) => l.id)])).toEqual([
      ['local', ['a']],
      ['server', ['a', 'b']],
    ]);
  });

  it('reports a failing source without losing the others', async () => {
    const lib = new LevelLibrary([source('local', [L('a')]), source('server', [], { fail: true })]);
    await lib.refresh();
    expect(lib.listing('local')!.levels).toHaveLength(1);
    expect(lib.listing('server')!.error).toMatch(/server is down/);
    expect(lib.listing('server')!.levels).toEqual([]);
  });

  it('does not read a source whose tab is hidden', async () => {
    const repo = source('repo', [L('a')], { available: false });
    await new LevelLibrary([repo]).refresh();
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe('LevelLibrary.alsoIn', () => {
  it('names the other sources holding the same level', async () => {
    const lib = new LevelLibrary([
      source('local', [L('shared')]),
      source('repo', [L('shared')]),
      source('server', [L('shared'), L('other')]),
    ]);
    await lib.refresh();
    expect(lib.alsoIn('shared', 'local').sort()).toEqual(['repo', 'server']);
    expect(lib.alsoIn('other', 'server')).toEqual([]);
  });

  it('is empty before anything has been read', () => {
    expect(new LevelLibrary([source('local', [L('a')])]).alsoIn('a', 'server')).toEqual([]);
  });
});

describe('LevelLibrary capabilities', () => {
  it('reports edit and delete from what the source actually implements', () => {
    const lib = new LevelLibrary([
      source('local', [], { editable: true, deletable: true }),
      source('server', [], { editable: false }),
    ]);
    expect(lib.canEdit('local')).toBe(true);
    expect(lib.canDelete('local')).toBe(true);
    expect(lib.canEdit('server')).toBe(false);
    expect(lib.canDelete('server')).toBe(false);
  });

  it('offers copy targets that can actually be written to', () => {
    const lib = new LevelLibrary([
      source('local', [], { editable: true }),
      source('repo', [], { editable: true }),
      source('server', [], { editable: false }),
    ]);
    expect(lib.copyTargets('server').map((s) => s.id)).toEqual(['local', 'repo']);
    expect(lib.copyTargets('local').map((s) => s.id)).toEqual(['repo']);
  });
});

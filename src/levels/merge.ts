import type { LevelData } from '../shared/types';

export function mergeLevels(builtin: LevelData[], remote: LevelData[]): LevelData[] {
  const remoteById = new Map(remote.map((l) => [l.id, l]));
  const usedRemoteIds = new Set<string>();

  // builtin positions, replaced by a same-id remote when present
  const head = builtin.map((b) => {
    const override = remoteById.get(b.id);
    if (override) { usedRemoteIds.add(b.id); return override; }
    return b;
  });

  // remaining remote levels, sorted by name
  const tail = remote
    .filter((r) => !usedRemoteIds.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...head, ...tail];
}

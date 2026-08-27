import type { LevelData } from '../../shared/types';
import { slugify } from '../serialize';

/**
 * Repo levels are files a designer reads in a git diff, so the filename follows
 * the level's name rather than its id. Names are not unique and can change, so:
 *
 *  - a level that already has a file keeps it unless its name changed
 *  - a name another level's file already uses gets a numeric suffix
 *
 * `existing` maps level id -> current filename, from the last listing.
 */
export function fileNameFor(level: LevelData, existing: ReadonlyMap<string, string>): string {
  const base = slugify(level.name);
  const preferred = `${base}.json`;

  const current = existing.get(level.id);
  if (current === preferred) return current;

  const taken = new Set(
    [...existing].filter(([id]) => id !== level.id).map(([, file]) => file),
  );
  if (!taken.has(preferred)) return preferred;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}.json`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${level.id}.json`;
}

/** Reject anything that could escape the published-levels directory. */
export function isSafeFileName(file: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.json$/.test(file);
}

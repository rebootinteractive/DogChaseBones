import type { LevelData } from '../shared/types';
import { slugify } from './serialize';

/**
 * Turning a level from the menu into a file you can commit under
 * src/levels/published/.
 */

/** Menu-ordered and collision-proof, since two levels may share a name. */
export function exportFileName(level: LevelData, index: number): string {
  return `${String(index + 1).padStart(2, '0')}-${slugify(level.name)}.json`;
}

/**
 * The draft flag is stamped on by the local backend at read time, not authored.
 * Committing it would leave the level permanently badged "draft", so it is
 * stripped here, and an otherwise empty meta is dropped entirely.
 */
export function exportPayload(level: LevelData): LevelData {
  const meta: Record<string, unknown> = { ...(level.meta ?? {}) };
  delete meta.draft;

  const out: LevelData = {
    id: level.id,
    name: level.name,
    prototype: level.prototype,
    elements: level.elements,
  };
  if (Object.keys(meta).length > 0) out.meta = meta;
  return out;
}

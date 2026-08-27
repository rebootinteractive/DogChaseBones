import type { LevelData } from '../shared/types';
import type { LevelSource, SourceId } from './sources/types';
import { canDelete, canEdit } from './sources/types';

export interface SourceListing {
  source: LevelSource;
  levels: LevelData[];
  /** Set when the source could not be read. Shown in place of an empty list. */
  error?: string;
}

/**
 * The three level sources, listed separately and never merged.
 *
 * Merging was the bug: a local copy replaced a same-id level from the server,
 * so a colleague's published edit vanished behind your own older one with
 * nothing on screen to say so. Now each source has its own tab, and a level
 * that exists in more than one is flagged rather than hidden.
 */
export class LevelLibrary {
  private listings = new Map<SourceId, SourceListing>();

  constructor(private sources: LevelSource[]) {}

  /** Sources whose tab should be shown. */
  get available(): LevelSource[] {
    return this.sources.filter((s) => s.available);
  }

  get(id: SourceId): LevelSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  /** Read every available source. One failing never stops the others. */
  async refresh(): Promise<SourceListing[]> {
    const results = await Promise.all(
      this.available.map(async (source): Promise<SourceListing> => {
        try {
          return { source, levels: await source.list() };
        } catch (err) {
          console.warn(`[LevelLibrary] ${source.id} failed:`, err);
          return { source, levels: [], error: describe(err) };
        }
      }),
    );
    this.listings = new Map(results.map((r) => [r.source.id, r]));
    return results;
  }

  listing(id: SourceId): SourceListing | undefined {
    return this.listings.get(id);
  }

  /**
   * Other sources holding a level with this id. This is the thing that was
   * invisible before: your local copy and someone else's published one are the
   * same level, and saving over one does not touch the other.
   */
  alsoIn(levelId: string, exclude: SourceId): SourceId[] {
    const out: SourceId[] = [];
    for (const [id, listing] of this.listings) {
      if (id === exclude) continue;
      if (listing.levels.some((l) => l.id === levelId)) out.push(id);
    }
    return out;
  }

  canEdit(id: SourceId): boolean {
    const source = this.get(id);
    return source ? canEdit(source) : false;
  }

  canDelete(id: SourceId): boolean {
    const source = this.get(id);
    return source ? canDelete(source) : false;
  }

  /** Sources a level could be copied into, excluding where it already is. */
  copyTargets(exclude: SourceId): LevelSource[] {
    return this.available.filter((s) => s.id !== exclude && canEdit(s));
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

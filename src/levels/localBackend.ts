import type { LevelData, LevelsBackend } from '../shared/types';
import { validateLevelData } from './serialize';

/**
 * Drafts, kept in this browser only. Saving in the editor puts a level here so
 * it survives a reload without going live for anyone else; publishing is a
 * separate step (a JSON file committed to the repo, or Supabase once it exists).
 */
export class LocalDraftBackend implements LevelsBackend {
  private key: string;

  constructor(prototype: string, private storage: Storage = localStorage) {
    this.key = `dcb-drafts:${prototype}`;
  }

  async fetch(): Promise<LevelData[]> {
    return this.read().map((l) => ({ ...l, meta: { ...(l.meta ?? {}), draft: true } }));
  }

  async insert(level: LevelData): Promise<void> {
    const rows = this.read();
    const i = rows.findIndex((l) => l.id === level.id);
    if (i >= 0) rows[i] = level; else rows.push(level);
    this.storage.setItem(this.key, JSON.stringify(rows));
  }

  private read(): LevelData[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(validateLevelData);
    } catch (err) {
      console.warn('[LocalDraftBackend] could not read drafts:', err);
      return [];
    }
  }
}

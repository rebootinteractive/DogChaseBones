import type { LevelData } from '../../shared/types';
import { validateLevelData } from '../serialize';
import type { LevelSource } from './types';

/**
 * Levels kept in this browser only. Nobody else can see them, and they do not
 * survive clearing site data -- which is why the menu offers a way to move them
 * to the repo or the server.
 */
export class LocalSource implements LevelSource {
  readonly id = 'local' as const;
  readonly label = 'Local';
  readonly blurb = 'Kept in this browser only. Nobody else can see these.';
  readonly available = true;

  private key: string;

  constructor(prototype: string, private storage: Storage = localStorage) {
    this.key = `levels-local:${prototype}`;
  }

  async list(): Promise<LevelData[]> {
    return this.read();
  }

  async save(level: LevelData): Promise<void> {
    const rows = this.read();
    const i = rows.findIndex((l) => l.id === level.id);
    if (i >= 0) rows[i] = level; else rows.push(level);
    this.write(rows);
  }

  async remove(level: LevelData): Promise<void> {
    this.write(this.read().filter((l) => l.id !== level.id));
  }

  private read(): LevelData[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(validateLevelData) : [];
    } catch (err) {
      console.warn('[LocalSource] could not read levels:', err);
      return [];
    }
  }

  private write(rows: LevelData[]) {
    this.storage.setItem(this.key, JSON.stringify(rows));
  }
}

import type { LevelData, LevelsBackend } from '../shared/types';
import { mergeLevels } from './merge';
import { validateLevelData } from './serialize';

export class LevelStore {
  constructor(
    private prototype: string,
    private backend: LevelsBackend,
    private builtin: LevelData[],
  ) {}

  async list(): Promise<LevelData[]> {
    try {
      const remote = await this.backend.fetch(this.prototype);
      return mergeLevels(this.builtin, remote);
    } catch (err) {
      console.warn('[LevelStore] remote fetch failed, using builtin only:', err);
      return [...this.builtin];
    }
  }

  async save(level: LevelData): Promise<void> {
    const withNs = { ...level, prototype: this.prototype };
    if (!validateLevelData(withNs)) throw new Error('invalid LevelData');
    await this.backend.insert(withNs);
  }
}

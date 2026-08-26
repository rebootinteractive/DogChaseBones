import type { LevelData, LevelsBackend } from '../shared/types';
import { mergeLevels } from './merge';
import { validateLevelData } from './serialize';

/**
 * Level I/O, in three layers.
 *
 *   builtin    shipped in the bundle (and anything committed under published/)
 *   published  shared with everyone -- Supabase, when it is configured
 *   drafts     private to this browser -- always local, never shared
 *
 * Drafts and publishing are deliberately separate backends. Saving must stay
 * private whether or not a shared backend exists, or connecting Supabase would
 * silently turn every Save into a publish.
 *
 * Later layers replace a same-id level from an earlier one, so a draft shadows
 * the published copy of the level you are editing, and a published level
 * supersedes the builtin it came from.
 */
export class LevelStore {
  constructor(
    private prototype: string,
    private drafts: LevelsBackend,
    private published: LevelsBackend | null,
    private builtin: LevelData[],
  ) {}

  /** Whether levels can be shared with everyone from inside the app. */
  get canPublish(): boolean {
    return this.published !== null;
  }

  async list(): Promise<LevelData[]> {
    let levels = [...this.builtin];

    if (this.published) {
      try {
        levels = mergeLevels(levels, await this.published.fetch(this.prototype));
      } catch (err) {
        // Never hard-fail on a network blip: authored levels still play.
        console.warn('[LevelStore] could not fetch published levels:', err);
      }
    }

    try {
      levels = mergeLevels(levels, await this.drafts.fetch(this.prototype));
    } catch (err) {
      console.warn('[LevelStore] could not read local drafts:', err);
    }

    return levels;
  }

  /** Private to this browser. Nobody else sees it. */
  async saveDraft(level: LevelData): Promise<void> {
    await this.drafts.insert(this.stamp(level));
  }

  /** Shared with everyone. Throws when no shared backend is configured. */
  async publish(level: LevelData): Promise<void> {
    if (!this.published) throw new Error('no published-levels backend configured');
    await this.published.insert(this.stamp(level));
  }

  private stamp(level: LevelData): LevelData {
    const withNs = { ...level, prototype: this.prototype };
    if (!validateLevelData(withNs)) throw new Error('invalid LevelData');
    return withNs;
  }
}

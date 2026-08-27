import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LevelData } from '../../shared/types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PROTOTYPE } from '../../config';
import { validateLevelData } from '../serialize';
import type { LevelSource } from './types';

interface LevelRow { id: string; prototype: string; name: string; data: LevelData }

/**
 * Levels shared with everyone, in the studio's Supabase project.
 *
 * Read-only here on purpose. There is no `save` and no `remove`: publishing
 * happens from the editor as a deliberate act, and the key has no delete
 * permission at all. To revise one, copy it down to Local or Repo, edit, and
 * publish again -- the id is preserved, so it replaces rather than duplicates.
 */
export class ServerSource implements LevelSource {
  readonly id = 'server' as const;
  readonly label = 'Server';
  readonly blurb = 'Shared with everyone. Read-only — copy one down to change it.';
  readonly available: boolean;

  private client: SupabaseClient | null;

  constructor(private prototype: string = PROTOTYPE) {
    this.available = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
    this.client = this.available ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  }

  async list(): Promise<LevelData[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from('levels')
      .select('data')
      .eq('prototype', this.prototype);
    if (error) throw error;
    return (data ?? []).map((r) => (r as { data: LevelData }).data).filter(validateLevelData);
  }

  /** Not part of LevelSource -- publishing is an explicit action, not a save. */
  async publish(level: LevelData): Promise<void> {
    if (!this.client) throw new Error('no Supabase project configured');
    const row: LevelRow = { id: level.id, prototype: this.prototype, name: level.name, data: level };
    // Conflict target matches the (prototype, id) key: an id is unique within a
    // game, not across the studio's shared table.
    const { error } = await this.client.from('levels').upsert(row, { onConflict: 'prototype,id' });
    if (error) throw error;
  }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LevelData } from '../../shared/types';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PROTOTYPE } from '../../config';
import { validateLevelData } from '../serialize';
import type { LevelSource } from './types';

interface LevelRow { id: string; prototype: string; name: string; data: LevelData }

/**
 * Levels shared with everyone, in the studio's Supabase project.
 *
 * There is no `save`: a level here is not edited in place. Publishing is a
 * deliberate act from the editor or the Push all button, and revising one means
 * copying it down to Local or Repo, editing, and publishing again -- the id is
 * preserved, so it replaces rather than duplicates.
 *
 * `remove` exists and deletes for everyone, immediately. It needs the delete
 * grant and policy from docs/supabase-schema.sql; without them Supabase reports
 * no error and removes no rows, so this verifies the row is actually gone.
 */
export class ServerSource implements LevelSource {
  readonly id = 'server' as const;
  readonly label = 'Server';
  readonly blurb = 'Shared with everyone. Copy one down to change it; Delete removes it for everyone.';
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

  /**
   * Delete for everyone. PostgREST answers a delete that matched no rows exactly
   * as it answers one that matched -- no error either way -- so a missing delete
   * policy would look like success. `select()` makes it return the rows it
   * actually removed, which is the only way to tell the two apart.
   */
  async remove(level: LevelData): Promise<void> {
    if (!this.client) throw new Error('no Supabase project configured');
    const { data, error } = await this.client
      .from('levels')
      .delete()
      .eq('prototype', this.prototype)
      .eq('id', level.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(
        'nothing was deleted -- the project is probably missing the delete grant or policy. ' +
        'Run the delete lines from docs/supabase-schema.sql.',
      );
    }
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

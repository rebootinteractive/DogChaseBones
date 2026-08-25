import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LevelData, LevelsBackend } from '../shared/types';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

// Row shape in the `levels` table.
interface LevelRow {
  id: string;
  prototype: string;
  name: string;
  data: LevelData;
}

export class SupabaseBackend implements LevelsBackend {
  private client: SupabaseClient;

  constructor(url = SUPABASE_URL, key = SUPABASE_ANON_KEY) {
    this.client = createClient(url, key);
  }

  async fetch(prototype: string): Promise<LevelData[]> {
    const { data, error } = await this.client
      .from('levels')
      .select('data')
      .eq('prototype', prototype);
    if (error) throw error;
    return (data ?? []).map((r) => (r as { data: LevelData }).data);
  }

  async insert(level: LevelData): Promise<void> {
    const row: LevelRow = { id: level.id, prototype: level.prototype, name: level.name, data: level };
    const { error } = await this.client.from('levels').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }
}

// In-memory backend used when HAS_BACKEND is false (offline dev).
export class MemoryBackend implements LevelsBackend {
  private rows: LevelData[] = [];
  async fetch(): Promise<LevelData[]> { return this.rows.map((l) => structuredClone(l)); }
  async insert(level: LevelData): Promise<void> {
    const i = this.rows.findIndex((l) => l.id === level.id);
    if (i >= 0) this.rows[i] = structuredClone(level); else this.rows.push(structuredClone(level));
  }
}

import type { LevelData } from '../../shared/types';
import { validateLevelData } from '../serialize';
import { fileNameFor } from './fileName';
import type { LevelSource } from './types';

export const REPO_ENDPOINT = '/__repo-levels';

interface RepoRow { file: string; level: LevelData }

/**
 * Levels as files in src/levels/published/, edited in place.
 *
 * A browser cannot write to disk, so this talks to a middleware the Vite dev
 * server installs. That middleware exists only under `npm run dev`, which is
 * exactly the rule we want: the deployed build has no server, so this source is
 * unavailable there and its tab never appears.
 *
 * Everything written here is an ordinary file change -- the designer commits,
 * diffs and reverts with git as usual.
 */
export class RepoSource implements LevelSource {
  readonly id = 'repo' as const;
  readonly label = 'Repo';
  readonly blurb = 'Files in the repo, under version control. Local dev server only.';
  readonly available = import.meta.env.DEV;

  /** level id -> filename, from the last listing, so a save reuses its file. */
  private files = new Map<string, string>();

  async list(): Promise<LevelData[]> {
    const rows = await this.request<RepoRow[]>('GET', REPO_ENDPOINT);
    this.files = new Map(rows.map((r) => [r.level.id, r.file]));
    return rows.map((r) => r.level).filter(validateLevelData);
  }

  async save(level: LevelData): Promise<void> {
    const previousFile = this.files.get(level.id);
    const file = fileNameFor(level, this.files);
    await this.request('PUT', REPO_ENDPOINT, {
      file,
      level,
      // Renaming a level renames its file; the old one is removed after write.
      previousFile: previousFile && previousFile !== file ? previousFile : undefined,
    });
    this.files.set(level.id, file);
  }

  async remove(level: LevelData): Promise<void> {
    const file = this.files.get(level.id);
    if (!file) throw new Error(`no file known for level ${level.id}`);
    await this.request('DELETE', `${REPO_ENDPOINT}?file=${encodeURIComponent(file)}`);
    this.files.delete(level.id);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
}

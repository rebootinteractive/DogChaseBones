import type { LevelData } from '../../shared/types';
import { validateLevelData } from '../serialize';

/**
 * Levels published from the in-game editor and committed to the repo. Until
 * this prototype gets a Supabase project, this is how a designer's level goes
 * live for everyone: Publish -> save the JSON here -> commit -> deploy.
 */
const modules = import.meta.glob<{ default: unknown }>('./*.json', { eager: true });

export const PUBLISHED_LEVELS: LevelData[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([path, mod]) => {
    if (validateLevelData(mod.default)) return [mod.default];
    console.warn(`[levels] ${path} is not a valid level and was skipped`);
    return [];
  });

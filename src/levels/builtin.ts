import type { LevelData } from '../shared/types';

/**
 * Levels compiled into the bundle.
 *
 * Deliberately empty: this prototype's levels live in Supabase, authored and
 * published from the in-game editor. Nothing is baked in, so an empty menu is a
 * reachable state -- if the shared backend cannot be reached and this browser
 * holds no drafts, there is nothing to play. MainMenu says so rather than
 * showing a blank list.
 *
 * To ship a level with the build again, add it here; `mergeLevels` puts these
 * first and lets a published level with the same id supersede one.
 */
export const BUILTIN_LEVELS: LevelData[] = [];

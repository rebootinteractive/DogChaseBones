import type { LevelData } from '../../shared/types';

export type SourceId = 'local' | 'repo' | 'server';

/**
 * One place levels come from. The three are kept apart on purpose: merged into
 * a single list, a local copy silently shadowed a colleague's published one and
 * the shadowing was invisible.
 *
 * `save` and `remove` are present only on sources that support them, so a
 * caller cannot offer an action the source cannot perform.
 */
export interface LevelSource {
  readonly id: SourceId;
  /** Tab label. */
  readonly label: string;
  /** One line under the tabs explaining what this source is. */
  readonly blurb: string;
  /** False when the source cannot be used right now -- its tab is hidden. */
  readonly available: boolean;

  list(): Promise<LevelData[]>;
  /** Present when a level here can be opened in the editor and saved back. */
  save?(level: LevelData): Promise<void>;
  /** Present when a level here can be removed. */
  remove?(level: LevelData): Promise<void>;
}

export function canEdit(source: LevelSource): boolean {
  return typeof source.save === 'function';
}

export function canDelete(source: LevelSource): boolean {
  return typeof source.remove === 'function';
}

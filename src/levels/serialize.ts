import type { LevelData, GameElement } from '../shared/types';

export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'level';
}

function isElement(v: unknown): v is GameElement {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.x === 'number' && typeof e.y === 'number';
}

export function validateLevelData(v: unknown): v is LevelData {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.prototype === 'string' &&
    Array.isArray(l.elements) &&
    l.elements.every(isElement)
  );
}

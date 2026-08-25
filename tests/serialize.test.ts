import { describe, it, expect } from 'vitest';
import { slugify, validateLevelData } from '../src/levels/serialize';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World 2!')).toBe('hello-world-2');
  });
  it('falls back to "level" when empty', () => {
    expect(slugify('!!!')).toBe('level');
  });
});

describe('validateLevelData', () => {
  const good = { id: 'a', name: 'A', prototype: 'p', elements: [] };

  it('accepts a well-formed level', () => {
    expect(validateLevelData(good)).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(validateLevelData({ id: 'a' })).toBe(false);
  });
  it('rejects when elements is not an array', () => {
    expect(validateLevelData({ ...good, elements: 'x' })).toBe(false);
  });
  it('rejects an element missing numeric x/y', () => {
    expect(validateLevelData({ ...good, elements: [{ type: 't', x: 'no', y: 0 }] })).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { fileNameFor, isSafeFileName } from '../src/levels/sources/fileName';
import type { LevelData } from '../src/shared/types';

const L = (id: string, name: string): LevelData => ({ id, name, prototype: 'p', elements: [] });

describe('fileNameFor', () => {
  it('names the file after the level, so a git diff is readable', () => {
    expect(fileNameFor(L('x', 'Tight Squeeze'), new Map())).toBe('tight-squeeze.json');
  });

  it('keeps the file a level already has', () => {
    const existing = new Map([['x', 'tight-squeeze.json']]);
    expect(fileNameFor(L('x', 'Tight Squeeze'), existing)).toBe('tight-squeeze.json');
  });

  it('follows a rename', () => {
    const existing = new Map([['x', 'old-name.json']]);
    expect(fileNameFor(L('x', 'New Name'), existing)).toBe('new-name.json');
  });

  it('does not steal a filename another level is using', () => {
    const existing = new Map([['other', 'tight-squeeze.json']]);
    expect(fileNameFor(L('x', 'Tight Squeeze'), existing)).toBe('tight-squeeze-2.json');
  });

  it('keeps counting past the first collision', () => {
    const existing = new Map([['a', 'level.json'], ['b', 'level-2.json'], ['c', 'level-3.json']]);
    expect(fileNameFor(L('x', 'Level'), existing)).toBe('level-4.json');
  });

  it('falls back for a name with nothing usable in it', () => {
    expect(fileNameFor(L('x', '!!!'), new Map())).toBe('level.json');
  });

  it('always produces a name the server will accept', () => {
    const names = ['Tight Squeeze', 'Bee-Mid/Easy', '  spaces  ', 'ünïcödé', '!!!', 'A'];
    for (const name of names) {
      expect(isSafeFileName(fileNameFor(L('x', name), new Map()))).toBe(true);
    }
  });
});

describe('isSafeFileName', () => {
  it('accepts a plain kebab-case json name', () => {
    expect(isSafeFileName('tight-squeeze.json')).toBe(true);
    expect(isSafeFileName('level-12.json')).toBe(true);
  });

  it('refuses anything that could escape the levels directory', () => {
    for (const bad of [
      '../package.json', '../../etc/passwd.json', 'a/b.json', '/abs.json',
      '.hidden.json', 'no-extension', 'UPPER.json', 'with space.json',
      'two..dots.json', '', '-leading.json',
    ]) {
      expect(isSafeFileName(bad), bad).toBe(false);
    }
  });
});

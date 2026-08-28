import { describe, it, expect } from 'vitest';
import { fillCycleLength, groupFill, groupTint, shadeColor, tintCycleLength } from '../src/render/color';

import { SETTINGS } from '../src/game/settings';

const PALETTE = [0xe0553f, 0x6cc24a, 0x4d96ff, 0xb46bd8];

/** Hue in degrees, for asserting that two swatches are actually different. */
function hueOf(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

describe('shadeColor', () => {
  it('leaves the colour alone at zero', () => {
    expect(shadeColor(0x4d96ff, 0)).toBe(0x4d96ff);
  });
  it('goes to white at +1 and black at -1', () => {
    expect(shadeColor(0x4d96ff, 1)).toBe(0xffffff);
    expect(shadeColor(0x4d96ff, -1)).toBe(0x000000);
  });
  it('clamps beyond the range instead of wrapping', () => {
    expect(shadeColor(0x4d96ff, 9)).toBe(0xffffff);
    expect(shadeColor(0x4d96ff, -9)).toBe(0x000000);
  });
  it('keeps every channel inside a byte', () => {
    for (const amount of [-0.9, -0.3, 0.3, 0.9]) {
      const c = shadeColor(0xe0553f, amount);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('groupTint', () => {
  it('hands out the palette in order first', () => {
    PALETTE.forEach((want, i) => expect(groupTint(i, PALETTE)).toBe(want));
  });

  it('does not restart at the first colour when the palette runs out', () => {
    expect(groupTint(PALETTE.length, PALETTE)).not.toBe(PALETTE[0]);
  });

  it('gives every group in a full cycle its own distinct tint', () => {
    const n = tintCycleLength(PALETTE);
    const seen = new Set(Array.from({ length: n }, (_, i) => groupTint(i, PALETTE)));
    expect(seen.size).toBe(n);
  });

  it('is stable for the same index', () => {
    expect(groupTint(7, PALETTE)).toBe(groupTint(7, PALETTE));
  });

  it('survives an empty palette and a negative index', () => {
    expect(groupTint(3, [])).toBe(0xffffff);
    expect(groupTint(-2, PALETTE)).toBe(PALETTE[0]);
  });
});

describe('groupFill', () => {
  it('uses every hue solid before it patterns any of them', () => {
    for (let i = 0; i < PALETTE.length; i++) expect(groupFill(i, PALETTE)).toBe('solid');
  });

  it('moves to the next pattern each time the palette wraps', () => {
    expect(groupFill(PALETTE.length, PALETTE)).toBe('stripe');
    expect(groupFill(PALETTE.length * 2, PALETTE)).toBe('cross');
    expect(groupFill(PALETTE.length * 3, PALETTE)).toBe('dot');
  });

  it('gives every group in a full cycle its own hue-and-fill pair', () => {
    const n = fillCycleLength(PALETTE);
    const seen = new Set(
      Array.from({ length: n }, (_, i) => `${groupTint(i, PALETTE)}/${groupFill(i, PALETTE)}`),
    );
    expect(seen.size).toBe(n);
  });

  it('covers thirty groups on the real palette without repeating a pair', () => {
    const palette = SETTINGS.editor.groupTints;
    const seen = new Set(
      Array.from({ length: 30 }, (_, i) => `${groupTint(i, palette)}/${groupFill(i, palette)}`),
    );
    expect(seen.size).toBe(30);
  });

  /**
   * The palette was cut from sixteen hues to eight because the sixteen were not
   * all distinguishable -- two of them sat five degrees apart. Anything much
   * denser than this is a list of colours that only looks like it has more
   * options in it.
   */
  it('keeps every hue in the real palette a clear step from the next', () => {
    const hues = SETTINGS.editor.groupTints.map(hueOf).sort((a, b) => a - b);
    const gaps = hues.map((h, n) => {
      const next = hues[(n + 1) % hues.length];
      return ((next - h) + 360) % 360;
    });
    expect(Math.min(...gaps)).toBeGreaterThan(25);
  });

  it('survives an empty palette and a negative index', () => {
    expect(groupFill(3, [])).toBe('solid');
    expect(groupFill(-2, PALETTE)).toBe('solid');
  });
});

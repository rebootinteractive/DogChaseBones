import { describe, it, expect } from 'vitest';
import { groupTint, shadeColor, tintCycleLength } from '../src/render/color';

const PALETTE = [0xe0553f, 0x6cc24a, 0x4d96ff, 0xb46bd8];

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

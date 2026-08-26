/**
 * Editor group tints. There are more groups possible than any palette can hold,
 * so once the palette is exhausted it is reused at a different lightness rather
 * than starting over at colour one -- adjacent groups stay tellable apart well
 * past the end of the list.
 */

/** Mix a colour towards white (amount > 0) or black (amount < 0). */
export function shadeColor(color: number, amount: number): number {
  const t = Math.max(-1, Math.min(1, amount));
  const mix = (channel: number) =>
    Math.round(t >= 0 ? channel + (255 - channel) * t : channel * (1 + t));

  const r = mix((color >> 16) & 0xff);
  const g = mix((color >> 8) & 0xff);
  const b = mix(color & 0xff);
  return (r << 16) | (g << 8) | b;
}

/** Lightness applied on each successive pass through the palette. */
const WRAP_SHADES = [0, 0.34, -0.34, 0.6, -0.58];

export function groupTint(index: number, tints: readonly number[]): number {
  if (tints.length === 0) return 0xffffff;
  const i = Math.max(0, Math.trunc(index));
  const base = tints[i % tints.length];
  const wrap = Math.floor(i / tints.length) % WRAP_SHADES.length;
  return shadeColor(base, WRAP_SHADES[wrap]);
}

/** How many visually distinct tints the palette yields before it truly repeats. */
export function tintCycleLength(tints: readonly number[]): number {
  return tints.length * WRAP_SHADES.length;
}

/**
 * Editor group swatches.
 *
 * A group is told apart on two independent channels: a hue from the palette,
 * and a fill pattern once the palette wraps. Lightness alone was not enough --
 * a pale repeat of a hue is hard to pick out of a list of thirty, where a
 * striped one is not.
 *
 * The palette is deliberately short. A sixteen-hue wheel put neighbours five
 * degrees apart, and two shapes that look the same colour is a worse failure
 * than two that share a hue but differ by an obvious hatch. Eight hues at least
 * thirty degrees apart, times four fills, is thirty-two groups that can all be
 * told from each other at a glance.
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

/** How a group's tiles are filled. The second channel, once hues run out. */
export type GroupFill = 'solid' | 'stripe' | 'cross' | 'dot';

const FILLS: readonly GroupFill[] = ['solid', 'stripe', 'cross', 'dot'];

/**
 * Fill for group `index`. Every hue is used solid before any is used striped,
 * so a level with a handful of groups never shows a pattern at all.
 */
export function groupFill(index: number, tints: readonly number[]): GroupFill {
  if (tints.length === 0) return 'solid';
  const i = Math.max(0, Math.trunc(index));
  return FILLS[Math.floor(i / tints.length) % FILLS.length];
}

/** Distinct (hue, fill) pairs available before the pattern channel repeats. */
export function fillCycleLength(tints: readonly number[]): number {
  return tints.length * FILLS.length;
}

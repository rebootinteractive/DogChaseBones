import raw from '../../gameSettings.json';

// gameSettings.json is the designer-owned tuning file at the repo root.
// It never changes rules -- only camera fit, timing, layout and colour.
// Colours are authored as "#rrggbb" strings and coerced to Pixi's 0xRRGGBB here.

export type ColorKey = keyof typeof raw.colors;

function toHex(css: string): number {
  return Number.parseInt(css.replace('#', ''), 16);
}

const colors = Object.fromEntries(
  Object.entries(raw.colors).map(([k, v]) => [k, toHex(v)]),
) as Record<ColorKey, number>;

export interface CameraMargin { top: number; right: number; bottom: number; left: number }

export const SETTINGS = {
  camera: {
    margin: raw.camera.margin as CameraMargin,
    maxCellSize: raw.camera.maxCellSize,
    minCellSize: raw.camera.minCellSize,
  },
  timing: raw.timing,
  layout: raw.layout,
  colors,
  debug: raw.debug,
};

export type Settings = typeof SETTINGS;

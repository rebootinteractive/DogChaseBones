import type { Graphics } from 'pixi.js';
import { SETTINGS } from '../game/settings';
import { colOf, rowOf } from '../game/cells';
import { cellX, cellY } from '../game/camera';
import type { Camera } from '../game/camera';
import { shadeColor } from './color';
import type { GroupFill } from './color';

const C = SETTINGS.colors;
const L = SETTINGS.layout;

export function drawCell(g: Graphics, cam: Camera, cell: number, dead: boolean) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const gap = L.cellGap;
  if (dead) {
    g.roundRect(x + gap, y + gap, cam.cell - gap * 2, cam.cell - gap * 2, L.cellRadius).fill({ color: C.dead });
    return;
  }
  g.roundRect(x + gap / 2, y + gap / 2, cam.cell - gap, cam.cell - gap, L.cellRadius)
    .fill({ color: C.cell })
    .stroke({ width: 1, color: C.cellStroke, alignment: 0.5 });
}

export function drawWall(g: Graphics, cam: Camera, cell: number) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const i = L.blockInset;
  const s = cam.cell - i * 2;
  g.roundRect(x + i, y + i, s, s, 4).fill({ color: C.wall }).stroke({ width: 2, color: C.wallStroke });
  const pad = s * 0.22;
  g.moveTo(x + i + pad, y + i + s - pad).lineTo(x + i + s - pad, y + i + pad).stroke({ width: 2, color: C.wallHatch });
}

/**
 * A block group reads as one piece: every cell gets a rounded tile, and the
 * seam between two cells of the same group is bridged so the outline is shared.
 *
 * `fill` is the editor's second channel for telling groups apart once the hue
 * palette wraps. The game always passes 'solid'.
 */
export function drawBlockGroup(
  g: Graphics,
  cam: Camera,
  cells: Set<number>,
  color: number = C.block,
  fill: GroupFill = 'solid',
) {
  const i = L.blockInset;
  const s = cam.cell - i * 2;

  for (const cell of cells) {
    const x = cellX(cam, cell) + i;
    const y = cellY(cam, cell) + i;
    g.roundRect(x, y, s, s, L.blockRadius).fill({ color }).stroke({ width: 2, color: C.blockStroke });
  }

  // Bridge the seams after the tiles so the joins sit on top of the strokes.
  const bridge = L.blockRadius;
  for (const cell of cells) {
    const c = colOf(cam.cols, cell);
    const r = rowOf(cam.cols, cell);
    const x = cellX(cam, cell) + i;
    const y = cellY(cam, cell) + i;
    if (c + 1 < cam.cols && cells.has(cell + 1)) {
      g.rect(x + s - bridge, y + 2, cam.cell - s + bridge * 2, s - 4).fill({ color });
    }
    if (r + 1 < cam.rows && cells.has(cell + cam.cols)) {
      g.rect(x + 2, y + s - bridge, s - 4, cam.cell - s + bridge * 2).fill({ color });
    }
  }

  if (fill === 'solid') return;

  // Hatching, drawn inside each tile so no clipping is needed. It sits under
  // the bones and badges, which are painted afterwards.
  const ink = shadeColor(color, -0.42);
  const pad = s * 0.16;
  const span = s - pad * 2;
  const width = Math.max(1.2, s * 0.055);

  for (const cell of cells) {
    const x = cellX(cam, cell) + i;
    const y = cellY(cam, cell) + i;

    // Dots read as nothing like the two line patterns, which is the point --
    // the fourth fill has to differ from the others at a glance, not just from
    // solid.
    if (fill === 'dot') {
      const r = Math.max(1.4, s * 0.085);
      for (const fx of [0.25, 0.75]) {
        for (const fy of [0.25, 0.75]) {
          g.circle(x + pad + span * fx, y + pad + span * fy, r).fill({ color: ink, alpha: 0.8 });
        }
      }
      continue;
    }

    for (const t of [0.28, 0.58, 0.88]) {
      // '\' running top-left to bottom-right, anchored on the tile diagonal.
      g.moveTo(x + pad, y + pad + span * t)
        .lineTo(x + pad + span * t, y + pad)
        .stroke({ width, color: ink, alpha: 0.75 });
      if (fill !== 'cross') continue;
      g.moveTo(x + s - pad, y + pad + span * t)
        .lineTo(x + s - pad - span * t, y + pad)
        .stroke({ width, color: ink, alpha: 0.75 });
    }
  }
}

export function drawBone(g: Graphics, cx: number, cy: number, size: number, locked = false) {
  const len = size * L.boneScale;
  const th = len * 0.3;
  const knob = th * 0.62;
  const color = locked ? C.boneLocked : C.bone;
  g.roundRect(cx - len / 2, cy - th / 2, len, th, th / 2).fill({ color });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.circle(cx + (sx * len) / 2, cy + sy * knob * 0.72, knob).fill({ color });
    }
  }
}

/**
 * A bone's activation tier: a *filled square*, deliberately unlike the round,
 * dark, bone-outlined count pip on the opposite corner. Two dark circles with a
 * white digit in each were indistinguishable at cell size, so these differ in
 * shape, fill and text colour at once rather than in any one of them.
 */
export function drawTierBadge(g: Graphics, cx: number, cy: number, r: number, locked: boolean) {
  const s = r * 1.85;
  g.roundRect(cx - s / 2, cy - s / 2, s, s, r * 0.42)
    .fill({ color: locked ? C.tierBadgeLocked : C.tierBadge })
    .stroke({ width: 1.2, color: locked ? C.boneLocked : 0xffffff, alpha: 0.85 });
}

export function drawBee(g: Graphics, cx: number, cy: number, size: number) {
  const r = size * L.beeScale * 0.5;
  g.ellipse(cx, cy, r * 1.5, r * 0.75).fill({ color: C.beeStroke, alpha: 0.35 });
  g.circle(cx, cy, r).fill({ color: C.bee }).stroke({ width: 1.5, color: C.beeStroke });
  for (const dx of [-0.38, 0.14]) {
    g.moveTo(cx + r * dx, cy - r * 0.85).lineTo(cx + r * dx, cy + r * 0.85)
      .stroke({ width: Math.max(1.5, r * 0.26), color: C.beeStripe });
  }
}

export function drawDog(g: Graphics, cx: number, cy: number, size: number) {
  const s = size;
  const x = cx - s / 2;
  const y = cy - s / 2;
  g.roundRect(x, y, s, s, s * 0.28).fill({ color: C.dog }).stroke({ width: 2, color: C.dogStroke });
  g.poly([x + s * 0.05, y + s * 0.1, x + s * 0.05, y + s * 0.4, x + s * 0.25, y + s * 0.22]).fill({ color: C.dogStroke });
  g.poly([x + s * 0.95, y + s * 0.1, x + s * 0.95, y + s * 0.4, x + s * 0.75, y + s * 0.22]).fill({ color: C.dogStroke });
  g.circle(x + s * 0.3, y + s * 0.4, s * 0.08).fill({ color: C.dogEye });
  g.circle(x + s * 0.7, y + s * 0.4, s * 0.08).fill({ color: C.dogEye });
  g.ellipse(x + s * 0.5, y + s * 0.7, s * 0.18, s * 0.13).fill({ color: C.dogSnout });
}

/** The xN pill that sits beside a queue entry. */
export function drawBadge(g: Graphics, cx: number, cy: number, w: number, h: number) {
  g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2)
    .fill({ color: C.badgeFill })
    .stroke({ width: 1, color: C.badgeStroke });
}

export function drawRouteCell(g: Graphics, cam: Camera, cell: number) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const gap = L.cellGap;
  g.roundRect(x + gap, y + gap, cam.cell - gap * 2, cam.cell - gap * 2, L.cellRadius)
    .fill({ color: C.route, alpha: 0.22 });
}

export function drawBeeReachCell(g: Graphics, cam: Camera, cell: number) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const gap = L.cellGap;
  g.roundRect(x + gap, y + gap, cam.cell - gap * 2, cam.cell - gap * 2, L.cellRadius)
    .fill({ color: C.beeDanger, alpha: 0.1 });
}

/** Editor: paint a target cell green when a dropped group would fit, red when not. */
export function drawPlacementCell(g: Graphics, cam: Camera, cell: number, ok: boolean) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const gap = L.cellGap;
  g.roundRect(x + gap, y + gap, cam.cell - gap * 2, cam.cell - gap * 2, L.cellRadius)
    .fill({ color: ok ? C.placeOk : C.placeBad, alpha: ok ? 0.2 : 0.34 })
    .stroke({ width: 1.5, color: ok ? C.placeOk : C.placeBad, alpha: 0.85 });
}

/** Editor: the footprint a group is being dragged away from. */
export function drawVacatedCell(g: Graphics, cam: Camera, cell: number) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const i = L.blockInset;
  g.roundRect(x + i, y + i, cam.cell - i * 2, cam.cell - i * 2, L.blockRadius)
    .stroke({ width: 1.5, color: C.ghost, alpha: 0.5 });
}

/** Backing disc for a stacked-bone count, so the number reads over the bone. */
export function drawBonePip(g: Graphics, cx: number, cy: number, r: number) {
  g.circle(cx, cy, r).fill({ color: C.badgeFill }).stroke({ width: 1.2, color: C.bone, alpha: 0.9 });
}

/** Editor: the shape the Block tool is painting into. */
export function drawSelectedCell(g: Graphics, cam: Camera, cell: number) {
  const x = cellX(cam, cell);
  const y = cellY(cam, cell);
  const i = L.blockInset;
  g.roundRect(x + i, y + i, cam.cell - i * 2, cam.cell - i * 2, L.blockRadius)
    .stroke({ width: 2, color: C.editorGuide, alpha: 0.95 });
}
